export const DEFAULT_ADMIN_USE_TYPES = ["default", "theme", "utility"] as const;

export type AdminUseType = (typeof DEFAULT_ADMIN_USE_TYPES)[number];

export function getDefaultAdminUseTypes(): AdminUseType[] {
  return [...DEFAULT_ADMIN_USE_TYPES];
}

export function normalizeAdminUseTypes(input: unknown): AdminUseType[] {
  const source = Array.isArray(input) ? input : [];
  const allowed = new Set(DEFAULT_ADMIN_USE_TYPES);
  const normalized = source
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value): value is AdminUseType => allowed.has(value as AdminUseType));
  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : getDefaultAdminUseTypes();
}

export function normalizeAdminUseType(input: unknown, allowedTypes?: readonly string[]): AdminUseType {
  const value = String(input || "").trim().toLowerCase();
  const allowed = new Set(
    (Array.isArray(allowedTypes) ? allowedTypes : DEFAULT_ADMIN_USE_TYPES).map((type) =>
      String(type || "").trim().toLowerCase(),
    ),
  );
  if (allowed.has(value)) return value as AdminUseType;
  return "default";
}

export type AdminPluginPageContext = {
  path: string;
  scope: "site" | "network" | "plugin" | "unknown";
  siteId: string | null;
  pluginId: string | null;
  section: string | null;
  isSettingsPage: boolean;
  isThemePage: boolean;
  isPluginPage: boolean;
};

export function buildAdminPluginPageContext(rawPath: string, fallbackSiteId?: string | null): AdminPluginPageContext {
  const path = String(rawPath || "").trim() || "/";
  const normalized = path.toLowerCase();
  const routePath = normalized.replace(/^\/app(?=\/|$)/, "") || "/";

  const siteMatch = routePath.match(/^\/site\/([^/]+)(?:\/(.*))?$/);
  const pluginMatch = routePath.match(/^\/plugins\/([^/?#]+)/);

  if (siteMatch) {
    const siteId = decodeURIComponent(siteMatch[1] || "").trim() || (fallbackSiteId ? String(fallbackSiteId) : null);
    const tail = String(siteMatch[2] || "").trim();
    const section = tail.split("/")[0] || null;
    const isSettingsPage = tail.startsWith("settings");
    const isThemePage = tail.startsWith("settings/themes");
    return {
      path,
      scope: "site",
      siteId,
      pluginId: null,
      section,
      isSettingsPage,
      isThemePage,
      isPluginPage: false,
    };
  }

  if (routePath.startsWith("/settings")) {
    const tail = routePath.replace(/^\/settings\/?/, "");
    const section = tail.split("/")[0] || "settings";
    return {
      path,
      scope: "network",
      siteId: fallbackSiteId ? String(fallbackSiteId) : null,
      pluginId: null,
      section,
      isSettingsPage: true,
      isThemePage: routePath.startsWith("/settings/themes"),
      isPluginPage: false,
    };
  }

  if (pluginMatch) {
    return {
      path,
      scope: "plugin",
      siteId: fallbackSiteId ? String(fallbackSiteId) : null,
      pluginId: decodeURIComponent(pluginMatch[1] || "").trim() || null,
      section: "plugins",
      isSettingsPage: false,
      isThemePage: false,
      isPluginPage: true,
    };
  }

  return {
    path,
    scope: "unknown",
    siteId: fallbackSiteId ? String(fallbackSiteId) : null,
    pluginId: null,
    section: null,
    isSettingsPage: false,
    isThemePage: false,
    isPluginPage: false,
  };
}
