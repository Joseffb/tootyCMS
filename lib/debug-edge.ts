function isTruthy(value: string) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isDebugModeEdge() {
  const raw = process.env.DEBUG_MODE || process.env.NEXT_PUBLIC_DEBUG_MODE || "";
  if (isTruthy(raw)) return true;
  return process.env.NODE_ENV === "development";
}

export function traceEdge(scope: string, message: string, payload?: unknown) {
  if (!isDebugModeEdge()) return;
  if (payload === undefined) {
    console.debug(`[trace:${scope}] ${message}`);
    return;
  }
  console.debug(`[trace:${scope}] ${message}`, payload);
}
