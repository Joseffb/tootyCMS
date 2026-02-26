const coreTagRegistry = new Set<string>([
  "utility",
  "auth",
  "teety",
  "theme",
  "analytics",
  "security",
  "content",
  "developer",
  "communication",
  "migration",
  "membership",
  "editorial",
  "commerce",
]);

function normalizeTag(raw: unknown) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

export function registerExtensionTags(input: unknown): string[] {
  const values = Array.isArray(input) ? input : [input];
  const added: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) continue;
    if (!coreTagRegistry.has(tag)) {
      coreTagRegistry.add(tag);
      added.push(tag);
    }
  }
  return added;
}

export function listRegisteredExtensionTags(): string[] {
  return Array.from(coreTagRegistry.values()).sort((a, b) => a.localeCompare(b));
}

export function normalizeExtensionTags(input: unknown): string[] {
  const values = Array.isArray(input) ? input : [];
  const normalized = values.map(normalizeTag).filter(Boolean);
  const unique = Array.from(new Set(normalized));
  if (unique.length > 0) registerExtensionTags(unique);
  return unique;
}
