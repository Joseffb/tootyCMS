import { isbot } from "isbot";
export const VIEW_COUNT_META_KEY = "view_count";
export const VIEW_COUNT_COOKIE = "tooty_view_count_window";
export const VIEW_COUNT_WINDOW_MS = 1000 * 60 * 60 * 6;
const VIEW_COUNT_COOKIE_LIMIT = 32;

function toPositiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function parseViewCount(value: unknown) {
  return toPositiveInt(value);
}

export function getViewCountSkipReason(headers: Headers) {
  const userAgent = String(headers.get("user-agent") || "").trim();
  const purpose = String(headers.get("purpose") || headers.get("sec-purpose") || "").trim().toLowerCase();
  const nextPrefetch = String(headers.get("next-router-prefetch") || "").trim().toLowerCase();
  const middlewarePrefetch = String(headers.get("x-middleware-prefetch") || "").trim().toLowerCase();

  if (purpose.includes("prefetch")) return "prefetch";
  if (nextPrefetch === "1" || nextPrefetch === "true") return "prefetch";
  if (middlewarePrefetch === "1" || middlewarePrefetch === "true") return "prefetch";
  if (userAgent && isbot(userAgent)) return "bot";
  return null;
}

function parseThrottleCookie(raw: string, now: number) {
  const entries = String(raw || "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const out = new Map<string, number>();
  for (const entry of entries) {
    const separator = entry.lastIndexOf(":");
    if (separator <= 0) continue;
    const postId = decodeURIComponent(entry.slice(0, separator));
    const timestamp = Number.parseInt(entry.slice(separator + 1), 10);
    if (!postId || !Number.isFinite(timestamp)) continue;
    if (now - timestamp > VIEW_COUNT_WINDOW_MS) continue;
    out.set(postId, timestamp);
  }
  return out;
}

function serializeThrottleCookie(values: Map<string, number>) {
  return Array.from(values.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, VIEW_COUNT_COOKIE_LIMIT)
    .map(([postId, timestamp]) => `${encodeURIComponent(postId)}:${timestamp}`)
    .join("|");
}

export function getViewCountThrottleState(input: {
  rawCookie: string;
  postId: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const values = parseThrottleCookie(input.rawCookie, now);
  const lastSeenAt = values.get(input.postId) || 0;
  const throttled = lastSeenAt > 0 && now - lastSeenAt < VIEW_COUNT_WINDOW_MS;
  if (!throttled) {
    values.set(input.postId, now);
  }
  return {
    throttled,
    serialized: serializeThrottleCookie(values),
  };
}
