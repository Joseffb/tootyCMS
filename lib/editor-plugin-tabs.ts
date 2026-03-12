import type { EditorMetaEntry } from "@/lib/editor-meta";
import type { PluginEditorTab, PluginEditorTabField } from "@/lib/extension-contracts";

export type EditorPluginTabMediaValue = {
  mediaId: string;
  url: string;
  mimeType: string;
  label: string;
};

export function normalizeEditorPluginId(pluginId: string) {
  return String(pluginId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function pluginEditorMetaPrefix(pluginId: string) {
  const normalized = normalizeEditorPluginId(pluginId);
  return normalized ? `_plugin_${normalized}_` : "_plugin_";
}

export function normalizeEditorPluginFieldKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function pluginEditorFieldMetaKey(pluginId: string, field: Pick<PluginEditorTabField, "key" | "metaKey">) {
  const base = normalizeEditorPluginFieldKey(field.metaKey || field.key);
  return `${pluginEditorMetaPrefix(pluginId)}${base}`;
}

export function isPluginEditorMetaKey(pluginId: string, key: string) {
  return String(key || "").trim().toLowerCase().startsWith(pluginEditorMetaPrefix(pluginId));
}

export function sortEditorPluginTabs<T extends { order?: number; label?: string; id: string }>(tabs: T[]) {
  return [...tabs].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left.order)) ? Number(left.order) : 0;
    const rightOrder = Number.isFinite(Number(right.order)) ? Number(right.order) : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftLabel = String(left.label || left.id || "");
    const rightLabel = String(right.label || right.id || "");
    return leftLabel.localeCompare(rightLabel);
  });
}

function readEntry(entries: EditorMetaEntry[], key: string) {
  return entries.find((entry) => entry.key === key)?.value ?? "";
}

function upsertEntry(entries: EditorMetaEntry[], key: string, value: string) {
  const nextValue = String(value ?? "");
  const existingIndex = entries.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    const copy = [...entries];
    copy[existingIndex] = { key, value: nextValue };
    return copy;
  }
  return [...entries, { key, value: nextValue }];
}

function deleteEntry(entries: EditorMetaEntry[], key: string) {
  return entries.filter((entry) => entry.key !== key);
}

export function readPluginEditorFieldValue(
  entries: EditorMetaEntry[],
  pluginId: string,
  field: PluginEditorTabField,
): string | boolean | EditorPluginTabMediaValue | Array<Record<string, unknown>> {
  const baseKey = pluginEditorFieldMetaKey(pluginId, field);
  if (field.type === "checkbox") {
    const value = readEntry(entries, baseKey);
    return value === "1" || value.toLowerCase() === "true";
  }
  if (field.type === "media") {
    return {
      mediaId: readEntry(entries, `${baseKey}_id`),
      url: readEntry(entries, `${baseKey}_url`),
      mimeType: readEntry(entries, `${baseKey}_mime_type`),
      label: readEntry(entries, `${baseKey}_label`),
    };
  }
  if (field.type === "repeater") {
    const raw = readEntry(entries, baseKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return readEntry(entries, baseKey) || String(field.defaultValue ?? "");
}

export function writePluginEditorFieldValue(
  entries: EditorMetaEntry[],
  pluginId: string,
  field: PluginEditorTabField,
  value: unknown,
) {
  const baseKey = pluginEditorFieldMetaKey(pluginId, field);
  if (field.type === "checkbox") {
    return upsertEntry(entries, baseKey, value ? "1" : "");
  }
  if (field.type === "media") {
    const next = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const mediaId = String(next.mediaId ?? "");
    const url = String(next.url ?? "");
    const mimeType = String(next.mimeType ?? "");
    const label = String(next.label ?? "");
    let output = entries;
    if (!mediaId && !url && !mimeType && !label) {
      output = deleteEntry(output, `${baseKey}_id`);
      output = deleteEntry(output, `${baseKey}_url`);
      output = deleteEntry(output, `${baseKey}_mime_type`);
      output = deleteEntry(output, `${baseKey}_label`);
      return output;
    }
    output = upsertEntry(output, `${baseKey}_id`, mediaId);
    output = upsertEntry(output, `${baseKey}_url`, url);
    output = upsertEntry(output, `${baseKey}_mime_type`, mimeType);
    output = upsertEntry(output, `${baseKey}_label`, label);
    return output;
  }
  if (field.type === "repeater") {
    return upsertEntry(entries, baseKey, JSON.stringify(Array.isArray(value) ? value : []));
  }
  return upsertEntry(entries, baseKey, String(value ?? ""));
}

export function filterTabsForDomain(tabs: PluginEditorTab[], domainKey: string) {
  const normalizedDomainKey = normalizeEditorPluginFieldKey(domainKey);
  return tabs.filter((tab) => {
    if (!Array.isArray(tab.supportsDomains) || tab.supportsDomains.length === 0) return true;
    return tab.supportsDomains.includes(normalizedDomainKey);
  });
}
