export type EditorMetaEntry = {
  key: string;
  value: string;
};

const LEGACY_HIDDEN_META_KEYS = new Set(["view_count"]);

export function isEditorVisibleMetaKey(key: string) {
  const normalized = String(key || "").trim();
  return normalized.length > 0 && !normalized.startsWith("_") && !LEGACY_HIDDEN_META_KEYS.has(normalized.toLowerCase());
}

export function filterVisibleEditorMetaEntries(entries: EditorMetaEntry[]) {
  return entries.filter((entry) => isEditorVisibleMetaKey(entry.key));
}

export function upsertEditorMetaEntry(entries: EditorMetaEntry[], key: string, value: string) {
  const nextKey = String(key || "").trim();
  if (!nextKey) return entries;
  const nextValue = String(value || "").trim();
  const existingIndex = entries.findIndex((entry) => entry.key.toLowerCase() === nextKey.toLowerCase());
  if (existingIndex >= 0) {
    const copy = [...entries];
    copy[existingIndex] = { key: nextKey, value: nextValue };
    return copy;
  }
  return [...entries, { key: nextKey, value: nextValue }];
}

export function updateEditorMetaEntryValue(entries: EditorMetaEntry[], key: string, value: string) {
  return entries.map((entry) =>
    entry.key === key ? { ...entry, value: String(value || "") } : entry,
  );
}
