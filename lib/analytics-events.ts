export type AnalyticsEventName =
  | "page_view"
  | "content_published"
  | "content_deleted"
  | "custom_event";

export type AnalyticsActorType = "anonymous" | "user" | "admin" | "system";

export type AnalyticsEvent = {
  version: 1;
  name: AnalyticsEventName;
  timestamp: string;
  siteId?: string;
  domain?: string;
  path?: string;
  actorType?: AnalyticsActorType;
  actorId?: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function asString(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

export function normalizeAnalyticsEvent(input: unknown): AnalyticsEvent | null {
  const event = asObject(input);
  const version = Number(event.version ?? 1);
  if (version !== 1) return null;
  const name = asString(event.name) as AnalyticsEventName;
  if (!["page_view", "content_published", "content_deleted", "custom_event"].includes(name)) {
    return null;
  }

  const actorTypeRaw = asString(event.actorType).toLowerCase();
  const actorType: AnalyticsActorType =
    actorTypeRaw === "anonymous" || actorTypeRaw === "user" || actorTypeRaw === "admin" || actorTypeRaw === "system"
      ? actorTypeRaw
      : "anonymous";

  const timestampRaw = asString(event.timestamp);
  const timestamp = timestampRaw || new Date().toISOString();
  const payload = asObject(event.payload);
  const meta = asObject(event.meta);

  return {
    version: 1,
    name,
    timestamp,
    siteId: asString(event.siteId) || undefined,
    domain: asString(event.domain) || undefined,
    path: asString(event.path) || undefined,
    actorType,
    actorId: asString(event.actorId) || undefined,
    payload,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}
