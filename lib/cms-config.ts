import { withLocalDevPort } from "@/lib/site-url";
import { getSettingByKey, setSettingByKey } from "@/lib/settings-store";

export const RANDOM_DEFAULT_IMAGES_KEY = "random_default_images_enabled";
export const SITE_URL_KEY = "site_url";
export const SEO_INDEXING_ENABLED_KEY = "seo_indexing_enabled";
export const SEO_META_TITLE_KEY = "seo_meta_title";
export const SEO_META_DESCRIPTION_KEY = "seo_meta_description";
export const SOCIAL_META_TITLE_KEY = "social_meta_title";
export const SOCIAL_META_DESCRIPTION_KEY = "social_meta_description";
export const SOCIAL_META_IMAGE_KEY = "social_meta_image";
export const MAIN_HEADER_ENABLED_KEY = "main_header_enabled";
export const MAIN_HEADER_SHOW_NETWORK_SITES_KEY = "main_header_show_network_sites";
export const WRITING_PERMALINK_STYLE_KEY = "writing_permalink_style";
export const WRITING_EDITOR_MODE_KEY = "writing_editor_mode";
export const WRITING_ENABLE_COMMENTS_KEY = "writing_enable_comments";
export const WRITING_CATEGORY_BASE_KEY = "writing_category_base";
export const WRITING_TAG_BASE_KEY = "writing_tag_base";
export const WRITING_PERMALINK_MODE_KEY = "writing_permalink_mode";
export const WRITING_SINGLE_PATTERN_KEY = "writing_single_pattern";
export const WRITING_LIST_PATTERN_KEY = "writing_list_pattern";
export const WRITING_NO_DOMAIN_PREFIX_KEY = "writing_no_domain_prefix";
export const WRITING_NO_DOMAIN_DATA_DOMAIN_KEY = "writing_no_domain_data_domain";
export const SCHEDULES_ENABLED_KEY = "schedules_enabled";
export const SCHEDULES_PING_SITEMAP_KEY = "schedules_ping_sitemap";
export const THEME_QUERY_NETWORK_ENABLED_KEY = "theme_query_network_enabled";
export const THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY = "theme_query_network_allowed_site_ids";
export const COMMUNICATION_ENABLED_KEY = "communication_enabled";
export const COMMUNICATION_RATE_LIMIT_MAX_KEY = "communication_rate_limit_max";
export const COMMUNICATION_RATE_LIMIT_WINDOW_SECONDS_KEY = "communication_rate_limit_window_seconds";

function siteScopedSettingKey(siteId: string, key: string) {
  return `site_${siteId}_${key}`;
}

async function getSettingRow(key: string) {
  const value = await getSettingByKey(key);
  return value === undefined ? null : { value };
}

export async function getBooleanSetting(key: string, fallback: boolean) {
  const row = await getSettingRow(key);
  if (!row) return fallback;
  return row.value === "true";
}

export async function setBooleanSetting(key: string, value: boolean) {
  await setSettingByKey(key, value ? "true" : "false");
}

export async function getTextSetting(key: string, fallback = "") {
  const row = await getSettingRow(key);
  return row?.value ?? fallback;
}

export async function setTextSetting(key: string, rawValue: string) {
  const value = rawValue.trim();
  await setSettingByKey(key, value);
}

export async function getSiteTextSetting(siteId: string, key: string, fallback = "") {
  return getTextSetting(siteScopedSettingKey(siteId, key), fallback);
}

export async function setSiteTextSetting(siteId: string, key: string, rawValue: string) {
  return setTextSetting(siteScopedSettingKey(siteId, key), rawValue);
}

export async function getSiteBooleanSetting(siteId: string, key: string, fallback: boolean) {
  return getBooleanSetting(siteScopedSettingKey(siteId, key), fallback);
}

export async function setSiteBooleanSetting(siteId: string, key: string, value: boolean) {
  return setBooleanSetting(siteScopedSettingKey(siteId, key), value);
}

function normalizePositiveInt(input: string, fallback: number) {
  const value = Number.parseInt(String(input || "").trim(), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

export type SiteCommunicationGovernance = {
  enabled: boolean;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
};

export async function getSiteCommunicationGovernance(siteId?: string | null): Promise<SiteCommunicationGovernance> {
  const globalEnabled = await getBooleanSetting(COMMUNICATION_ENABLED_KEY, true);
  const globalRateLimitMax = normalizePositiveInt(await getTextSetting(COMMUNICATION_RATE_LIMIT_MAX_KEY, "60"), 60);
  const globalRateLimitWindowSeconds = normalizePositiveInt(
    await getTextSetting(COMMUNICATION_RATE_LIMIT_WINDOW_SECONDS_KEY, "60"),
    60,
  );

  if (!siteId) {
    return {
      enabled: globalEnabled,
      rateLimitMax: globalRateLimitMax,
      rateLimitWindowSeconds: globalRateLimitWindowSeconds,
    };
  }

  const [enabled, rateLimitMaxRaw, rateLimitWindowRaw] = await Promise.all([
    getSiteBooleanSetting(siteId, COMMUNICATION_ENABLED_KEY, globalEnabled),
    getSiteTextSetting(siteId, COMMUNICATION_RATE_LIMIT_MAX_KEY, String(globalRateLimitMax)),
    getSiteTextSetting(siteId, COMMUNICATION_RATE_LIMIT_WINDOW_SECONDS_KEY, String(globalRateLimitWindowSeconds)),
  ]);

  return {
    enabled,
    rateLimitMax: normalizePositiveInt(rateLimitMaxRaw, globalRateLimitMax),
    rateLimitWindowSeconds: normalizePositiveInt(rateLimitWindowRaw, globalRateLimitWindowSeconds),
  };
}

function normalizeSiteUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function defaultSiteUrlFromEnv() {
  const rootDomainRaw = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "").trim();
  if (!rootDomainRaw) return "";
  const rootDomain = rootDomainRaw.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  const nextAuthRaw = (process.env.NEXTAUTH_URL || "").trim();
  const protocol = nextAuthRaw.startsWith("https://") ? "https" : "http";

  if (process.env.NEXT_PUBLIC_VERCEL_ENV) {
    return `${protocol}://${rootDomain}`;
  }

  let port = process.env.PORT || "3000";
  if (nextAuthRaw) {
    try {
      const parsed = new URL(nextAuthRaw);
      if (parsed.port) port = parsed.port;
    } catch {
      // keep default port
    }
  }
  return `${protocol}://${rootDomain}:${port}`;
}

export async function isRandomDefaultImagesEnabled() {
  return getBooleanSetting(RANDOM_DEFAULT_IMAGES_KEY, true);
}

export async function setRandomDefaultImagesEnabled(enabled: boolean) {
  await setBooleanSetting(RANDOM_DEFAULT_IMAGES_KEY, enabled);
}

export async function getRandomDefaultImagesSetting() {
  const enabled = await isRandomDefaultImagesEnabled();
  return { key: RANDOM_DEFAULT_IMAGES_KEY, enabled };
}

export async function getSiteUrlSetting() {
  const value = await getTextSetting(SITE_URL_KEY, defaultSiteUrlFromEnv());
  return { key: SITE_URL_KEY, value: withLocalDevPort(value) };
}

export async function setSiteUrlSetting(rawValue: string) {
  const value = normalizeSiteUrl(rawValue);
  await setTextSetting(SITE_URL_KEY, value);
}

export async function getSiteUrlSettingForSite(siteId: string, fallback: string) {
  const value = await getSiteTextSetting(siteId, SITE_URL_KEY, fallback);
  return { key: siteScopedSettingKey(siteId, SITE_URL_KEY), value: withLocalDevPort(value) };
}

export async function setSiteUrlSettingForSite(siteId: string, rawValue: string) {
  const value = normalizeSiteUrl(rawValue);
  await setSiteTextSetting(siteId, SITE_URL_KEY, value);
}

export async function getReadingSettings() {
  const [randomDefaults, siteUrl, indexingEnabled, metaTitle, metaDescription] =
    await Promise.all([
      getRandomDefaultImagesSetting(),
      getSiteUrlSetting(),
      getBooleanSetting(SEO_INDEXING_ENABLED_KEY, true),
      getTextSetting(SEO_META_TITLE_KEY, ""),
      getTextSetting(SEO_META_DESCRIPTION_KEY, ""),
    ]);
  const [mainHeaderEnabled, showNetworkSites, queryNetworkEnabled, queryNetworkAllowedSiteIds] = await Promise.all([
    getBooleanSetting(MAIN_HEADER_ENABLED_KEY, true),
    getBooleanSetting(MAIN_HEADER_SHOW_NETWORK_SITES_KEY, false),
    getBooleanSetting(THEME_QUERY_NETWORK_ENABLED_KEY, false),
    getTextSetting(THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY, ""),
  ]);

  return {
    randomDefaults,
    siteUrl,
    seo: {
      indexingEnabled,
      metaTitle,
      metaDescription,
    },
    header: {
      mainHeaderEnabled,
      showNetworkSites,
    },
    queryNetwork: {
      enabled: queryNetworkEnabled,
      allowedSiteIds: queryNetworkAllowedSiteIds,
    },
  };
}

export async function getWritingSettings() {
  const [permalinkStyle, editorMode, categoryBase, tagBase] = await Promise.all([
    getTextSetting(WRITING_PERMALINK_STYLE_KEY, "post-name"),
    getTextSetting(WRITING_EDITOR_MODE_KEY, "rich-text"),
    getTextSetting(WRITING_CATEGORY_BASE_KEY, "c"),
    getTextSetting(WRITING_TAG_BASE_KEY, "t"),
  ]);

  return {
    permalinkStyle,
    editorMode,
    categoryBase,
    tagBase,
  };
}

export async function getSiteWritingSettings(siteId: string) {
  const global = await getWritingSettings();
  const [permalinkMode, singlePattern, listPattern, noDomainPrefix, noDomainDataDomain, editorMode, enableComments] = await Promise.all([
    getSiteTextSetting(siteId, WRITING_PERMALINK_MODE_KEY, "default"),
    getSiteTextSetting(siteId, WRITING_SINGLE_PATTERN_KEY, "/%domain%/%slug%"),
    getSiteTextSetting(siteId, WRITING_LIST_PATTERN_KEY, "/%domain_plural%"),
    getSiteTextSetting(siteId, WRITING_NO_DOMAIN_PREFIX_KEY, ""),
    getSiteTextSetting(siteId, WRITING_NO_DOMAIN_DATA_DOMAIN_KEY, "post"),
    getSiteTextSetting(siteId, WRITING_EDITOR_MODE_KEY, global.editorMode),
    getSiteBooleanSetting(siteId, WRITING_ENABLE_COMMENTS_KEY, true),
  ]);

  const permalinkModeValue: "default" | "custom" = permalinkMode === "custom" ? "custom" : "default";

  return {
    permalinkMode: permalinkModeValue,
    singlePattern: singlePattern || "/%domain%/%slug%",
    listPattern: listPattern || "/%domain_plural%",
    noDomainPrefix: noDomainPrefix.trim().toLowerCase(),
    noDomainDataDomain: noDomainDataDomain.trim().toLowerCase() || "post",
    editorMode: editorMode || global.editorMode,
    enableComments,
    categoryBase: global.categoryBase,
    tagBase: global.tagBase,
  };
}

export async function getScheduleSettings() {
  const [enabled, pingSitemap] = await Promise.all([
    getBooleanSetting(SCHEDULES_ENABLED_KEY, false),
    getBooleanSetting(SCHEDULES_PING_SITEMAP_KEY, false),
  ]);

  return {
    enabled,
    pingSitemap,
  };
}
