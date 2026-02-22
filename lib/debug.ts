type AnyRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|key|authorization|cookie)/i;

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
}
