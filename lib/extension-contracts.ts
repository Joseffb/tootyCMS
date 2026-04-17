import type { ThemeTokens } from "@/lib/theme-system";
import { normalizeExtensionTags } from "@/lib/extension-tags";
import { SITE_CAPABILITIES, type SiteCapability } from "@/lib/rbac";
import { normalizePluginSuggestedRoles } from "@/lib/plugin-permissions";
import type { AiAction, AiTextToolApplyAction, AiTextToolSource } from "@/lib/ai-contracts";

export type ExtensionKind = "plugin" | "theme";

export type ExtensionFieldType = "text" | "textarea" | "password" | "number" | "checkbox" | "select" | "media";

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
  rows?: number;
};

export type PluginEditorSnippet = {
  id: string;
  title: string;
  description?: string;
  content: string;
};

export type PluginEditorTabFieldType = ExtensionFieldType | "radio" | "repeater";

export type PluginEditorTabField = Omit<ExtensionSettingsField, "type"> & {
  type?: PluginEditorTabFieldType;
  metaKey?: string;
  fields?: PluginEditorTabField[];
};

export type PluginEditorTabFragment =
  | {
      kind: "html";
      html: string;
    }
  | {
      kind: "text-tool";
      toolId: string;
      title: string;
      action: AiAction;
      source: AiTextToolSource;
      applyActions: AiTextToolApplyAction[];
      instructionPlaceholder?: string;
      submitLabel?: string;
    };

export type PluginEditorTabSection = {
  id: string;
  title: string;
  description?: string;
  fields?: PluginEditorTabField[];
  fragment?: PluginEditorTabFragment;
};

export type PluginEditorTab = {
  id: string;
  label: string;
  order?: number;
  supportsDomains?: string[];
  requiresCapability?: SiteCapability;
  sections: PluginEditorTabSection[];
};

export type PluginMenuPlacement = "settings" | "root" | "both";

export type PluginMenuConfig = {
  label?: string;
  path?: string;
  order?: number;
};

export type PluginCollectionContentModel = {
  kind: "collection";
  parentTypeKey: string;
  childTypeKey: string;
  childParentMetaKey: string;
  childParentKeyMetaKey?: string;
  parentHandleMetaKey: string;
  workflowMetaKey: string;
  orderMetaKey: string;
  mediaMetaKey?: string;
  ctaTextMetaKey?: string;
  ctaUrlMetaKey?: string;
  workflowStates?: string[];
  workspaceLayout?: "default" | "split";
  parentEditorFields?: PluginCollectionWorkspaceField[];
  childEditorFields?: PluginCollectionWorkspaceField[];
  childNestedItems?: PluginCollectionNestedItemsModel;
};

export type PluginCollectionWorkspaceField = ExtensionSettingsField & {
  target?: "title" | "description" | "content" | "slug" | "image" | "meta";
  metaKey?: string;
};

export type PluginCollectionNestedItemsModel = {
  metaKey: string;
  singularLabel: string;
  pluralLabel: string;
  fields: ExtensionSettingsField[];
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
  menuPlacement?: PluginMenuPlacement;
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
    aiProviders?: boolean;
  };
  menu?: PluginMenuConfig;
  settingsMenu?: PluginMenuConfig;
  settingsFields?: ExtensionSettingsField[];
  contentModel?: PluginCollectionContentModel;
  editor?: {
    snippets?: PluginEditorSnippet[];
    tabs?: PluginEditorTab[];
  };
  permissions?: {
    contentMeta?: {
      requested?: boolean;
      suggestedRoles?: string[];
    };
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
      candidate.type === "select" ||
      candidate.type === "media"
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
    rows:
      Number.isFinite(Number(candidate.rows)) && Number(candidate.rows) > 0
        ? Math.max(1, Math.trunc(Number(candidate.rows)))
        : undefined,
  };
}

function cleanPluginEditorTabField(field: unknown, allowRepeater = true): PluginEditorTabField | null {
  const candidate = asRecord(field);
  const base = cleanField(field);
  if (!base) return null;
  const rawType = String(candidate.type ?? "").trim().toLowerCase();
  const type: PluginEditorTabFieldType =
    rawType === "radio" || (allowRepeater && rawType === "repeater")
      ? (rawType as PluginEditorTabFieldType)
      : (base.type as PluginEditorTabFieldType);
  const metaKey = normalizeMetaKey(candidate.metaKey);
  const fields =
    type === "repeater" && Array.isArray(candidate.fields)
      ? candidate.fields
          .map((entry) => cleanPluginEditorTabField(entry, false))
          .filter((entry): entry is PluginEditorTabField => Boolean(entry))
      : undefined;
  return {
    ...base,
    type,
    metaKey: metaKey || undefined,
    fields: fields && fields.length > 0 ? fields : undefined,
  };
}

function cleanPluginEditorTabSection(section: unknown): PluginEditorTabSection | null {
  const candidate = asRecord(section);
  const id = String(candidate.id ?? "").trim();
  const title = String(candidate.title ?? "").trim();
  if (!id || !title) return null;
  const fields = Array.isArray(candidate.fields)
    ? candidate.fields
        .map((entry) => cleanPluginEditorTabField(entry))
        .filter((entry): entry is PluginEditorTabField => Boolean(entry))
    : [];
  const fragmentCandidate = candidate.fragment ? asRecord(candidate.fragment) : null;
  const fragmentHtml = String(fragmentCandidate?.html ?? "").trim();
  const fragmentKind = String(fragmentCandidate?.kind ?? "").trim().toLowerCase();
  const fragment = (() => {
    if (!fragmentCandidate) return undefined;
    if (fragmentKind === "html" && fragmentHtml) {
      return { kind: "html", html: fragmentHtml } satisfies PluginEditorTabFragment;
    }
    if (fragmentKind !== "text-tool") return undefined;
    const toolId = String(fragmentCandidate.toolId ?? "").trim();
    const toolTitle = String(fragmentCandidate.title ?? "").trim();
    const actionRaw = String(fragmentCandidate.action ?? "").trim().toLowerCase();
    const sourceRaw = String(fragmentCandidate.source ?? "").trim().toLowerCase();
    const applyActions = Array.isArray(fragmentCandidate.applyActions)
      ? Array.from(
          new Set(
            fragmentCandidate.applyActions
              .map((entry) => String(entry ?? "").trim().toLowerCase())
              .filter((entry) => entry === "replace_selection" || entry === "insert_below"),
          ),
        ) as AiTextToolApplyAction[]
      : [];
    if (
      !toolId ||
      !toolTitle ||
      !["generate", "rewrite", "summarize", "classify"].includes(actionRaw) ||
      !["selection", "content"].includes(sourceRaw) ||
      applyActions.length === 0
    ) {
      return undefined;
    }
    return {
      kind: "text-tool",
      toolId,
      title: toolTitle,
      action: actionRaw as AiAction,
      source: sourceRaw as AiTextToolSource,
      applyActions,
      instructionPlaceholder: String(fragmentCandidate.instructionPlaceholder ?? "").trim() || undefined,
      submitLabel: String(fragmentCandidate.submitLabel ?? "").trim() || undefined,
    } satisfies PluginEditorTabFragment;
  })();
  if (fields.length === 0 && !fragment) return null;
  return {
    id,
    title,
    description: String(candidate.description ?? "").trim(),
    fields: fields.length > 0 ? fields : undefined,
    fragment,
  };
}

function cleanPluginEditorTab(tab: unknown): PluginEditorTab | null {
  const candidate = asRecord(tab);
  const id = String(candidate.id ?? "").trim();
  const label = String(candidate.label ?? "").trim();
  if (!id || !label) return null;
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections
        .map((entry) => cleanPluginEditorTabSection(entry))
        .filter((entry): entry is PluginEditorTabSection => Boolean(entry))
    : [];
  if (sections.length === 0) return null;
  const supportsDomains = Array.isArray(candidate.supportsDomains)
    ? Array.from(
        new Set(
          candidate.supportsDomains
            .map((entry) => normalizeMetaKey(entry))
            .filter(Boolean),
        ),
      )
    : undefined;
  const normalizedCapability = String(candidate.requiresCapability ?? "").trim();
  const requiresCapability = (SITE_CAPABILITIES as readonly string[]).includes(normalizedCapability)
    ? (normalizedCapability as SiteCapability)
    : undefined;
  return {
    id,
    label,
    order: Number.isFinite(Number(candidate.order)) ? Number(candidate.order) : undefined,
    supportsDomains: supportsDomains && supportsDomains.length > 0 ? supportsDomains : undefined,
    requiresCapability,
    sections,
  };
}

function normalizeMetaKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 80);
}

function cleanCollectionWorkspaceField(field: unknown): PluginCollectionWorkspaceField | null {
  const candidate = asRecord(field);
  const base = cleanField(field);
  if (!base) return null;
  const rawTarget = String(candidate.target ?? "").trim().toLowerCase();
  const target =
    rawTarget === "title" ||
    rawTarget === "description" ||
    rawTarget === "content" ||
    rawTarget === "slug" ||
    rawTarget === "image" ||
    rawTarget === "meta"
      ? rawTarget
      : normalizeMetaKey(candidate.metaKey)
        ? "meta"
        : undefined;
  const metaKey = normalizeMetaKey(candidate.metaKey);
  if (!target) return null;
  if (target === "meta" && !metaKey) return null;
  return {
    ...base,
    target,
    metaKey: target === "meta" ? metaKey : undefined,
  };
}

function cleanNestedItemsModel(input: unknown): PluginCollectionNestedItemsModel | undefined {
  const candidate = asRecord(input);
  const metaKey = normalizeMetaKey(candidate.metaKey);
  const singularLabel = String(candidate.singularLabel ?? "").trim();
  const pluralLabel = String(candidate.pluralLabel ?? "").trim();
  const fields = Array.isArray(candidate.fields)
    ? candidate.fields
        .map((field) => cleanField(field))
        .filter((field): field is ExtensionSettingsField => Boolean(field))
    : [];
  if (!metaKey || !singularLabel || !pluralLabel || fields.length === 0) return undefined;
  return {
    metaKey,
    singularLabel,
    pluralLabel,
    fields,
  };
}

function cleanCollectionContentModel(input: unknown): PluginCollectionContentModel | undefined {
  const candidate = asRecord(input);
  if (String(candidate.kind ?? "").trim().toLowerCase() !== "collection") return undefined;

  const parentTypeKey = normalizeExtensionId(String(candidate.parentTypeKey ?? ""));
  const childTypeKey = normalizeExtensionId(String(candidate.childTypeKey ?? ""));
  const childParentMetaKey = normalizeMetaKey(candidate.childParentMetaKey);
  const parentHandleMetaKey = normalizeMetaKey(candidate.parentHandleMetaKey);
  const workflowMetaKey = normalizeMetaKey(candidate.workflowMetaKey);
  const orderMetaKey = normalizeMetaKey(candidate.orderMetaKey);
  if (!parentTypeKey || !childTypeKey || !childParentMetaKey || !parentHandleMetaKey || !workflowMetaKey || !orderMetaKey) {
    return undefined;
  }

  const workflowStates = Array.isArray(candidate.workflowStates)
    ? Array.from(
        new Set(
          candidate.workflowStates
            .map((entry) => normalizeExtensionId(String(entry ?? "")))
            .filter(Boolean),
        ),
      )
    : undefined;
  const workspaceLayout = String(candidate.workspaceLayout ?? "").trim().toLowerCase();
  const parentEditorFields = Array.isArray(candidate.parentEditorFields)
    ? candidate.parentEditorFields
        .map((field) => cleanCollectionWorkspaceField(field))
        .filter((field): field is PluginCollectionWorkspaceField => Boolean(field))
    : undefined;
  const childEditorFields = Array.isArray(candidate.childEditorFields)
    ? candidate.childEditorFields
        .map((field) => cleanCollectionWorkspaceField(field))
        .filter((field): field is PluginCollectionWorkspaceField => Boolean(field))
    : undefined;
  const childNestedItems = cleanNestedItemsModel(candidate.childNestedItems);

  return {
    kind: "collection",
    parentTypeKey,
    childTypeKey,
    childParentMetaKey,
    childParentKeyMetaKey: normalizeMetaKey(candidate.childParentKeyMetaKey) || undefined,
    parentHandleMetaKey,
    workflowMetaKey,
    orderMetaKey,
    mediaMetaKey: normalizeMetaKey(candidate.mediaMetaKey) || undefined,
    ctaTextMetaKey: normalizeMetaKey(candidate.ctaTextMetaKey) || undefined,
    ctaUrlMetaKey: normalizeMetaKey(candidate.ctaUrlMetaKey) || undefined,
    workflowStates: workflowStates?.length ? workflowStates : undefined,
    workspaceLayout: workspaceLayout === "split" ? "split" : undefined,
    parentEditorFields: parentEditorFields?.length ? parentEditorFields : undefined,
    childEditorFields: childEditorFields?.length ? childEditorFields : undefined,
    childNestedItems,
  };
}

function cleanPluginPermissions(input: unknown) {
  const candidate = asRecord(input);
  const contentMeta = asRecord(candidate.contentMeta);
  const requested = Boolean(contentMeta.requested);
  const suggestedRoles = normalizePluginSuggestedRoles(contentMeta.suggestedRoles);
  if (!requested && suggestedRoles.length === 0) return undefined;
  return {
    contentMeta: {
      requested,
      suggestedRoles,
    },
  };
}

export function validatePluginContract(input: unknown, fallbackId: string): PluginContract | null {
  const candidate = asRecord(input);
  const id = normalizeExtensionId(String(candidate.id ?? fallbackId));
  const name = String(candidate.name ?? id).trim();
  if (!id || !name) return null;

  const menu = candidate.menu ? asRecord(candidate.menu) : null;
  const settingsMenu = candidate.settingsMenu ? asRecord(candidate.settingsMenu) : null;
  const editor = candidate.editor ? asRecord(candidate.editor) : null;
  const snippetsRaw = Array.isArray(editor?.snippets) ? editor?.snippets : [];
  const tabsRaw = Array.isArray(editor?.tabs) ? editor?.tabs : [];
  const settingsRaw = Array.isArray(candidate.settingsFields) ? candidate.settingsFields : [];
  const scopeRaw = String(candidate.scope ?? "").trim().toLowerCase();
  // Backward-compat: legacy "core" scope is normalized to "network".
  const scope: "site" | "network" = scopeRaw === "network" || scopeRaw === "core" ? "network" : "site";
  const distributionRaw = String(candidate.distribution ?? "").trim().toLowerCase();
  const distribution: "core" | "community" = distributionRaw === "core" ? "core" : "community";
  const placementRaw = String(candidate.menuPlacement ?? "").trim().toLowerCase();
  const menuPlacement: PluginMenuPlacement =
    placementRaw === "root" || placementRaw === "both" ? (placementRaw as PluginMenuPlacement) : "settings";

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
    menuPlacement,
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
      aiProviders: candidate.capabilities
        ? Boolean(asRecord(candidate.capabilities).aiProviders ?? false)
        : false,
    },
    menu: menu
      ? {
          label: String(menu.label ?? name).trim(),
          path: String(menu.path ?? "").trim(),
          order: Number.isFinite(Number(menu.order)) ? Number(menu.order) : undefined,
        }
      : undefined,
    settingsMenu: settingsMenu
      ? {
          label: String(settingsMenu.label ?? `${name} Settings`).trim(),
          path: String(settingsMenu.path ?? "").trim(),
          order: Number.isFinite(Number(settingsMenu.order)) ? Number(settingsMenu.order) : undefined,
        }
      : undefined,
    settingsFields: settingsRaw.map(cleanField).filter((field): field is ExtensionSettingsField => Boolean(field)),
    contentModel: cleanCollectionContentModel(candidate.contentModel),
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
          tabs: tabsRaw
            .map((tab) => cleanPluginEditorTab(tab))
            .filter((tab): tab is PluginEditorTab => Boolean(tab)),
        }
      : undefined,
    permissions: cleanPluginPermissions(candidate.permissions),
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
        const requiresCapability = (SITE_CAPABILITIES as readonly string[]).includes(requiresCapabilityRaw)
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
