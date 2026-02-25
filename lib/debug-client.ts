function isTruthy(value: string) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isDebugModeClient() {
  const raw = process.env.DEBUG_MODE || process.env.NEXT_PUBLIC_DEBUG_MODE || "";
  if (isTruthy(raw)) return true;
  return process.env.NODE_ENV === "development";
}

function getTraceTier() {
  const configured = (process.env.TRACE_PROFILE || "").trim().toLowerCase();
  if (configured === "test") return "Test";
  if (configured === "prod" || configured === "production") return "Prod";
  if (configured === "dev" || configured === "development") return "Dev";
  if (process.env.NODE_ENV === "production") return "Prod";
  if (process.env.NODE_ENV === "test") return "Test";
  return "Dev";
}

export function traceClient(scope: string, message: string, payload?: unknown) {
  if (!isDebugModeClient()) return;
  const tier = getTraceTier();
  const level: "info" | "warn" | "error" = "info";
  if (payload === undefined) {
    console.info(`[trace:${tier}:${level}:${scope}] ${message}`);
    return;
  }
  console.info(`[trace:${tier}:${level}:${scope}] ${message}`, payload);
}
