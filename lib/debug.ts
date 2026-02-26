type AnyRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|key|authorization|cookie)/i;
const TRACE_DIR = process.env.TRACE_LOG_DIR || "logs/traces";
const TRACE_RETENTION_DAYS = Number(process.env.TRACE_RETENTION_DAYS || 14);
const TRACE_MAX_FILES = Number(process.env.TRACE_MAX_FILES || 60);
let traceWriteChain = Promise.resolve();
let traceFsUnavailable = false;
let lastPruneKey = "";
let fsPromisesLoader: Promise<any> | null = null;

export type TraceLevel = "info" | "warn" | "error";

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const obj = value as AnyRecord;
    const out: AnyRecord = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? "***redacted***" : redact(v);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 300) {
    return `${value.slice(0, 300)}…`;
  }
  return value;
}

export function isDebugMode() {
  const raw = process.env.DEBUG_MODE || process.env.NEXT_PUBLIC_DEBUG_MODE || "";
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  return process.env.NODE_ENV === "development";
}

type TraceTier = "Test" | "Dev" | "Prod";

function getTraceTier(): TraceTier {
  const configured = (process.env.TRACE_PROFILE || "").trim().toLowerCase();
  if (configured === "test") return "Test";
  if (configured === "prod" || configured === "production") return "Prod";
  if (configured === "dev" || configured === "development") return "Dev";
  if (process.env.NODE_ENV === "production") return "Prod";
  if (process.env.NODE_ENV === "test") return "Test";
  return "Dev";
}

function normalizedTraceLevel(level: unknown): TraceLevel {
  const raw = String(level || "info").trim().toLowerCase();
  if (raw === "warn" || raw === "error") return raw;
  return "info";
}

function safeRetentionDays() {
  if (!Number.isFinite(TRACE_RETENTION_DAYS)) return 14;
  return Math.max(1, Math.min(365, Math.trunc(TRACE_RETENTION_DAYS)));
}

function safeMaxFiles() {
  if (!Number.isFinite(TRACE_MAX_FILES)) return 60;
  return Math.max(10, Math.min(500, Math.trunc(TRACE_MAX_FILES)));
}

async function pruneTraceFiles() {
  const now = new Date();
  const pruneKey = now.toISOString().slice(0, 10);
  if (lastPruneKey === pruneKey) return;
  lastPruneKey = pruneKey;

  const fsPromises = await getFsPromises();
  if (!fsPromises) return;
  const { readdir, rm } = fsPromises;
  const retentionMs = safeRetentionDays() * 24 * 60 * 60 * 1000;
  const maxFiles = safeMaxFiles();
  const entries = (await readdir(TRACE_DIR, { withFileTypes: true })) as Array<{
    isFile: () => boolean;
    name: string;
  }>;

  const files = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
    .map((entry) => {
      const day = entry.name.slice(0, 10);
      return {
        name: entry.name,
        ms: Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) ? 0 : Date.parse(`${day}T00:00:00.000Z`),
      };
    })
    .sort((a, b) => b.ms - a.ms);

  const stale = files.filter((file) => file.ms > 0 && now.getTime() - file.ms > retentionMs);
  for (const file of stale) {
    await rm(`${TRACE_DIR}/${file.name}`, { force: true });
  }

  const afterStale = files.filter((file) => !stale.some((candidate) => candidate.name === file.name));
  if (afterStale.length <= maxFiles) return;
  const overflow = afterStale.slice(maxFiles);
  for (const file of overflow) {
    await rm(`${TRACE_DIR}/${file.name}`, { force: true });
  }
}

export function trace(scope: string, message: string, payload?: unknown, levelInput: TraceLevel = "info") {
  if (!isDebugMode()) return;
  const tier = getTraceTier();
  const level = normalizedTraceLevel(levelInput);
  const safePayload = payload === undefined ? undefined : redact(payload);
  if (payload === undefined) {
    if (level === "error") console.error(`[trace:${tier}:${level}:${scope}] ${message}`);
    else if (level === "warn") console.warn(`[trace:${tier}:${level}:${scope}] ${message}`);
    else console.info(`[trace:${tier}:${level}:${scope}] ${message}`);
  } else {
    if (level === "error") console.error(`[trace:${tier}:${level}:${scope}] ${message}`, safePayload);
    else if (level === "warn") console.warn(`[trace:${tier}:${level}:${scope}] ${message}`, safePayload);
    else console.info(`[trace:${tier}:${level}:${scope}] ${message}`, safePayload);
  }

  if (typeof window !== "undefined") return;

  traceWriteChain = traceWriteChain
    .then(async () => {
      if (traceFsUnavailable) return;
      try {
        if (typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined") return;
        const fsPromises = await getFsPromises();
        if (!fsPromises) return;
        const { mkdir, appendFile } = fsPromises;
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const filePath = `${TRACE_DIR}/${day}.jsonl`;
        await mkdir(TRACE_DIR, { recursive: true });
        await pruneTraceFiles();
        const line = JSON.stringify({
          ts: now.toISOString(),
          tier,
          level,
          scope,
          message,
          payload: safePayload,
        });
        await appendFile(filePath, `${line}\n`, "utf8");
      } catch {
        traceFsUnavailable = true;
      }
    })
    .catch(() => {
      // ignore trace write failures
    });
}

async function getFsPromises() {
  if (!fsPromisesLoader) {
    fsPromisesLoader = (async () => {
      try {
        return await import("node:fs/promises");
      } catch {
        return import("fs/promises");
      }
    })();
  }
  return fsPromisesLoader;
}

export function traceInfo(scope: string, message: string, payload?: unknown) {
  trace(scope, message, payload, "info");
}

export function traceWarn(scope: string, message: string, payload?: unknown) {
  trace(scope, message, payload, "warn");
}

export function traceError(scope: string, message: string, payload?: unknown) {
  trace(scope, message, payload, "error");
}

export async function __flushTraceForTests() {
  await traceWriteChain;
}
