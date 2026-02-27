import type { ThemeTokens } from "@/lib/theme-system";
import { normalizeExtensionTags } from "@/lib/extension-tags";
import { SITE_CAPABILITIES, type SiteCapability } from "@/lib/rbac";

export type ExtensionKind = "plugin" | "theme";

export type ExtensionFieldType = "text" | "textarea" | "password" | "number" | "checkbox" | "select";

export type ExtensionSettingsOption = {
  label: string;
  value: string;
};

export type ExtensionSettingsField = {
  key: string;
  label: string;
  type?: ExtensionFieldType;
  options?: ExtensionSettingsOption[];
  placeholder?: string;
  helpText?: string;
  defaultValue?: string;
};

export type PluginEditorSnippet = {
  id: string;
  title: string;
  description?: string;
  content: string;
};

export type PluginContract = {
  kind: "plugin";
  id: string;
  name: string;
  distribution?: "core" | "community";
  developer?: string;
  website?: string;
  description?: string;
  version?: string;
  minCoreVersion?: string;
  tags?: string[];
  authProviderId?: string;
  scope?: "site" | "network";
  capabilities?: {
    hooks?: boolean;
    adminExtensions?: boolean;
    contentTypes?: boolean;
    serverHandlers?: boolean;
    authExtensions?: boolean;
    scheduleJobs?: boolean;
    communicationProviders?: boolean;
    commentProviders?: boolean;
    webCallbacks?: boolean;
  };
  menu?: {
    label?: string;
    path?: string;
    order?: number;
  };
  settingsFields?: ExtensionSettingsField[];
  editor?: {
    snippets?: PluginEditorSnippet[];
  };
};

export type ThemeContract = {
  kind: "theme";
  id: string;
  name: string;
  description?: string;
  version?: string;
  minCoreVersion?: string;
  tags?: string[];
  capabilities?: {
    layouts?: boolean;
    components?: boolean;
    styles?: boolean;
    assets?: boolean;
    renderLogic?: boolean;
  };
  tokens?: Partial<ThemeTokens>;
  assets?: {
    styles?: string[];
    scripts?: string[];
  };
  templates?: {
    home?: string;
    post?: string;
  };
  queries?: Array<{
    key: string;
    source: "content.list";
    scope?: "site" | "network";
    route?: string;
    params?: Record<string, unknown>;
    requiresCapability?: SiteCapability;
  }>;
  settingsFields?: ExtensionSettingsField[];
};

export function normalizeExtensionId(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cleanField(field: unknown): ExtensionSettingsField | null {
  const candidate = asRecord(field);
  const key = String(candidate.key ?? "").trim();
  const label = String(candidate.label ?? "").trim();
  if (!key || !label) return null;
  return {
    key,
    label,
    type:
      candidate.type === "text" ||
      candidate.type === "textarea" ||
      candidate.type === "password" ||
      candidate.type === "number" ||
      candidate.type === "checkbox" ||
      candidate.type === "select"
        ? candidate.type
        : "text",
    options: Array.isArray(candidate.options)
      ? candidate.options
          .map((entry) => asRecord(entry))
          .flatMap<ExtensionSettingsOption>((entry) => {
            const value = String(entry.value ?? "").trim();
            if (!value) return [];
            const label = String(entry.label ?? value).trim() || value;
            return [{ label, value }];
          })
      : undefined,
    placeholder: String(candidate.placeholder ?? "").trim(),
    helpText: String(candidate.helpText ?? "").trim(),
    defaultValue:
      candidate.defaultValue === undefined || candidate.defaultValue === null
        ? undefined
        : String(candidate.defaultValue),
  };
}

export function validatePluginContract(input: unknown, fallbackId: string): PluginContract | null {
  const candidate = asRecord(input);
  const id = normalizeExtensionId(String(candidate.id ?? fallbackId));
  const name = String(candidate.name ?? id).trim();
  if (!id || !name) return null;

  const menu = candidate.menu ? asRecord(candidate.menu) : null;
  const editor = candidate.editor ? asRecord(candidate.editor) : null;
  const snippetsRaw = Array.isArray(editor?.snippets) ? editor?.snippets : [];
  const settingsRaw = Array.isArray(candidate.settingsFields) ? candidate.settingsFields : [];
  const scopeRaw = String(candidate.scope ?? "").trim().toLowerCase();
  // Backward-compat: legacy "core" scope is normalized to "network".
  const scope: "site" | "network" = scopeRaw === "network" || scopeRaw === "core" ? "network" : "site";
  const distributionRaw = String(candidate.distribution ?? "").trim().toLowerCase();
  const distribution: "core" | "community" = distributionRaw === "core" ? "core" : "community";

  return {
    kind: "plugin",
    id,
    name,
    distribution,
    developer: String(candidate.developer ?? "").trim(),
    website: String(candidate.website ?? "").trim(),
    description: String(candidate.description ?? "").trim(),
    version: String(candidate.version ?? "").trim(),
    minCoreVersion: String(candidate.minCoreVersion ?? "").trim(),
    tags: normalizeExtensionTags(candidate.tags),
    authProviderId: String(candidate.authProviderId ?? "").trim().toLowerCase(),
    scope,
    capabilities: {
      hooks: candidate.capabilities ? Boolean(asRecord(candidate.capabilities).hooks ?? true) : true,
      adminExtensions: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).adminExtensions ?? true)
        : true,
      contentTypes: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).contentTypes ?? false)
        : false,
      serverHandlers: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).serverHandlers ?? false)
        : false,
      authExtensions: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).authExtensions ?? false)
        : false,
      scheduleJobs: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).scheduleJobs ?? false)
        : false,
      communicationProviders: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).communicationProviders ?? false)
        : false,
      commentProviders: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).commentProviders ?? false)
        : false,
      webCallbacks: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).webCallbacks ?? false)
        : false,
    },
    menu: menu
      ? {
          label: String(menu.label ?? name).trim(),
          path: String(menu.path ?? "").trim(),
          order: Number.isFinite(Number(menu.order)) ? Number(menu.order) : undefined,
        }
      : undefined,
    settingsFields: settingsRaw.map(cleanField).filter((field): field is ExtensionSettingsField => Boolean(field)),
    editor: editor
      ? {
          snippets: snippetsRaw.flatMap<PluginEditorSnippet>((snippet, index) => {
            const s = asRecord(snippet);
            const title = String(s.title ?? "").trim();
            const content = String(s.content ?? "");
            if (!title || !content) return [];
            return [
              {
                id: String(s.id ?? `${id}-snippet-${index + 1}`).trim(),
                title,
                description: String(s.description ?? "").trim(),
                content,
              },
            ];
          }),
        }
      : undefined,
  };
}

export function validateThemeContract(input: unknown, fallbackId: string): ThemeContract | null {
  const candidate = asRecord(input);
  const id = normalizeExtensionId(String(candidate.id ?? fallbackId));
  const name = String(candidate.name ?? id).trim();
  if (!id || !name) return null;
  const settingsRaw = Array.isArray(candidate.settingsFields) ? candidate.settingsFields : [];
  const assets = asRecord(candidate.assets);
  const templates = asRecord(candidate.templates);
  const tokens = asRecord(candidate.tokens);
  const caps = asRecord(candidate.capabilities);
  const queriesRaw = Array.isArray(candidate.queries) ? candidate.queries : [];

  return {
    kind: "theme",
    id,
    name,
    description: String(candidate.description ?? "").trim(),
    version: String(candidate.version ?? "").trim(),
    minCoreVersion: String(candidate.minCoreVersion ?? "").trim(),
    tags: normalizeExtensionTags(candidate.tags),
    capabilities: {
      layouts: Boolean(caps.layouts ?? true),
      components: Boolean(caps.components ?? true),
      styles: Boolean(caps.styles ?? true),
      assets: Boolean(caps.assets ?? true),
      renderLogic: Boolean(caps.renderLogic ?? true),
    },
    tokens: tokens as Partial<ThemeTokens>,
    assets: {
      styles: Array.isArray(assets.styles) ? assets.styles.map((item) => String(item)).filter(Boolean) : [],
      scripts: Array.isArray(assets.scripts) ? assets.scripts.map((item) => String(item)).filter(Boolean) : [],
    },
    templates: {
      home: typeof templates.home === "string" ? templates.home : undefined,
      post: typeof templates.post === "string" ? templates.post : undefined,
    },
    queries: queriesRaw
      .map((entry) => asRecord(entry))
      .flatMap((entry) => {
        const key = String(entry.key ?? "").trim();
        const source = String(entry.source ?? "").trim();
        if (!key || source !== "content.list") return [];
        const scopeRaw = String(entry.scope ?? "site").trim();
        const scope = scopeRaw === "network" ? "network" : "site";
        const route = String(entry.route ?? "").trim().toLowerCase();
        const params = entry.params && typeof entry.params === "object" ? (entry.params as Record<string, unknown>) : {};
        const requiresCapabilityRaw = String(entry.requiresCapability ?? "").trim();
        const requiresCapability = SITE_CAPABILITIES.includes(requiresCapabilityRaw as SiteCapability)
          ? (requiresCapabilityRaw as SiteCapability)
          : undefined;
        return [
          {
            key,
            source: "content.list" as const,
            scope,
            route,
            params,
            requiresCapability,
          },
        ];
      }),
    settingsFields: settingsRaw.map(cleanField).filter((field): field is ExtensionSettingsField => Boolean(field)),
  };
}
