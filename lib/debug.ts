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

export function trace(scope: string, message: string, payload?: unknown) {
  if (!isDebugMode()) return;
  const safePayload = payload === undefined ? undefined : redact(payload);
  if (payload === undefined) {
    console.debug(`[trace:${scope}] ${message}`);
  } else {
    console.debug(`[trace:${scope}] ${message}`, safePayload);
  }

  // Fire-and-forget JSONL trace persistence for Node runtime.
  // Edge runtime and read-only filesystems are handled gracefully.
  traceWriteChain = traceWriteChain
    .then(async () => {
      if (traceFsUnavailable) return;
      try {
        // Skip filesystem writes in Edge runtime.
        if (typeof (globalThis as any).EdgeRuntime !== "undefined") return;
        const [{ mkdir, appendFile }] = await Promise.all([import("node:fs/promises")]);
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const filename = `${day}.jsonl`;
        const dir = TRACE_DIR;
        const filePath = `${dir}/${filename}`;
        await mkdir(dir, { recursive: true });
        const line = JSON.stringify({
          ts: now.toISOString(),
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
      // ignore trace logging failures
    });
}
