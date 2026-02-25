export type DomainEventName = string;

export type DomainEventActorType = "anonymous" | "user" | "admin" | "system";

export type DomainEvent = {
  id?: string;
  version: 1;
  name: DomainEventName;
  timestamp: string;
  siteId?: string;
  domain?: string;
  path?: string;
  actorType?: DomainEventActorType;
  actorId?: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

const CORE_DOMAIN_EVENT_NAMES = [
  "page_view",
  "content_published",
  "content_deleted",
  "custom_event",
  "site.created",
  "user.invited",
  "communication.queued",
  "communication.sent",
  "communication.failed",
  "communication.dead",
  "rbac.role.changed",
] as const;

const registeredDomainEventNames = new Set<string>(CORE_DOMAIN_EVENT_NAMES);

function isValidEventName(name: string) {
  if (!name) return false;
  if (registeredDomainEventNames.has(name)) return true;
  return name.startsWith("plugin.");
}

export function registerDomainEventName(name: string) {
  const normalized = asString(name);
  if (!normalized) return false;
  // Core names are fixed; extension names must use plugin.* namespace.
  if (!normalized.startsWith("plugin.") && !registeredDomainEventNames.has(normalized)) return false;
  registeredDomainEventNames.add(normalized);
  return true;
}

export function registerDomainEventNames(names: string[]) {
  for (const name of names) registerDomainEventName(name);
}

export function listDomainEventNames() {
  return Array.from(registeredDomainEventNames.values()).sort((a, b) => a.localeCompare(b));
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function asString(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

export function normalizeDomainEvent(input: unknown): DomainEvent | null {
  const event = asObject(input);
  const version = Number(event.version ?? 1);
  if (version !== 1) return null;
  const name = asString(event.name) as DomainEventName;
  if (!isValidEventName(name)) {
    return null;
  }

  const actorTypeRaw = asString(event.actorType).toLowerCase();
  const actorType: DomainEventActorType =
    actorTypeRaw === "anonymous" || actorTypeRaw === "user" || actorTypeRaw === "admin" || actorTypeRaw === "system"
      ? actorTypeRaw
      : "anonymous";

  const timestampRaw = asString(event.timestamp);
  const timestamp = timestampRaw || new Date().toISOString();
  const payload = asObject(event.payload);
  const meta = asObject(event.meta);

  return {
    id: asString(event.id) || undefined,
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
