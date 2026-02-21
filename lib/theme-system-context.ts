export type ThemeSystemContext = {
  route_kind: string;
  data_domain: string;
  category_base: string;
  tag_base: string;
  site_id: string;
  site_domain: string;
  site_subdomain: string;
  site_is_primary: boolean;
  theme_id: string;
  theme_name: string;
};

const DEFAULTS: ThemeSystemContext = {
  route_kind: "home",
  data_domain: "post",
  category_base: "c",
  tag_base: "t",
  site_id: "",
  site_domain: "",
  site_subdomain: "",
  site_is_primary: false,
  theme_id: "",
  theme_name: "",
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeSlugLike(value: string, fallback: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return normalized || fallback;
}

export function buildThemeSystemContext(input: Record<string, unknown>) {
  const site = (input.site as Record<string, unknown> | undefined) ?? {};
  const theme = (input.theme as Record<string, unknown> | undefined) ?? {};

  const routeKind = asString(input.route_kind, DEFAULTS.route_kind).trim().toLowerCase() || DEFAULTS.route_kind;
  const dataDomainRaw =
    asString(input.data_domain, "") ||
    asString(input.dataDomain, "") ||
    asString((input.system as any)?.data_domain, "") ||
    DEFAULTS.data_domain;

  const categoryBaseRaw = asString(input.category_base, DEFAULTS.category_base);
  const tagBaseRaw = asString(input.tag_base, DEFAULTS.tag_base);

  const siteDomain = asString(site.domain, asString(site.url, "")).replace(/^https?:\/\//, "");
  const system: ThemeSystemContext = {
    route_kind: routeKind,
    data_domain: normalizeSlugLike(dataDomainRaw, DEFAULTS.data_domain),
    category_base: normalizeSlugLike(categoryBaseRaw, DEFAULTS.category_base),
    tag_base: normalizeSlugLike(tagBaseRaw, DEFAULTS.tag_base),
    site_id: asString(site.id, DEFAULTS.site_id),
    site_domain: siteDomain || DEFAULTS.site_domain,
    site_subdomain: asString(site.subdomain, DEFAULTS.site_subdomain),
    site_is_primary: Boolean(site.isPrimary ?? site.is_primary ?? DEFAULTS.site_is_primary),
    theme_id: asString(theme.id, DEFAULTS.theme_id),
    theme_name: asString(theme.name, DEFAULTS.theme_name),
  };

  return system;
}

