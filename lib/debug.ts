type AnyRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|key|authorization|cookie)/i;
const TRACE_DIR = process.env.TRACE_LOG_DIR || "logs/traces";
let traceWriteChain = Promise.resolve();
let traceFsUnavailable = false;

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

export function trace(scope: string, message: string, payload?: unknown) {
  if (!isDebugMode()) return;
  const tier = getTraceTier();
  const safePayload = payload === undefined ? undefined : redact(payload);
  if (payload === undefined) {
    console.debug(`[trace:${tier}:${scope}] ${message}`);
  } else {
    console.debug(`[trace:${tier}:${scope}] ${message}`, safePayload);
  }

  if (typeof window !== "undefined") return;

  traceWriteChain = traceWriteChain
    .then(async () => {
      if (traceFsUnavailable) return;
      try {
        if (typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined") return;
        const fsPromisesModule = ["fs", "promises"].join("/");
        const { mkdir, appendFile } = await import(fsPromisesModule);
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const filePath = `${TRACE_DIR}/${day}.jsonl`;
        await mkdir(TRACE_DIR, { recursive: true });
        const line = JSON.stringify({
          ts: now.toISOString(),
          tier,
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
