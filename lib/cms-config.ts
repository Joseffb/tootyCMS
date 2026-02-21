import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const RANDOM_DEFAULT_IMAGES_KEY = "random_default_images_enabled";
export const SITE_URL_KEY = "site_url";
export const SEO_INDEXING_ENABLED_KEY = "seo_indexing_enabled";
export const SEO_META_TITLE_KEY = "seo_meta_title";
export const SEO_META_DESCRIPTION_KEY = "seo_meta_description";
export const MAIN_HEADER_ENABLED_KEY = "main_header_enabled";
export const MAIN_HEADER_SHOW_NETWORK_SITES_KEY = "main_header_show_network_sites";
export const WRITING_PERMALINK_STYLE_KEY = "writing_permalink_style";
export const WRITING_EDITOR_MODE_KEY = "writing_editor_mode";
export const WRITING_CATEGORY_BASE_KEY = "writing_category_base";
export const WRITING_TAG_BASE_KEY = "writing_tag_base";
export const SCHEDULES_ENABLED_KEY = "schedules_enabled";
export const SCHEDULES_PING_SITEMAP_KEY = "schedules_ping_sitemap";

async function getSettingRow(key: string) {
  return db.query.cmsSettings.findFirst({
    where: eq(cmsSettings.key, key),
    columns: { value: true },
  });
}

export async function getBooleanSetting(key: string, fallback: boolean) {
  const row = await getSettingRow(key);
  if (!row) return fallback;
  return row.value === "true";
}

export async function setBooleanSetting(key: string, value: boolean) {
  await db
    .insert(cmsSettings)
    .values({ key, value: value ? "true" : "false" })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: value ? "true" : "false" },
    });
}

export async function getTextSetting(key: string, fallback = "") {
  const row = await getSettingRow(key);
  return row?.value ?? fallback;
}

export async function setTextSetting(key: string, rawValue: string) {
  const value = rawValue.trim();
  await db
    .insert(cmsSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value },
    });
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
  const value = await getTextSetting(SITE_URL_KEY, "");
  return { key: SITE_URL_KEY, value };
}

export async function setSiteUrlSetting(rawValue: string) {
  const value = normalizeSiteUrl(rawValue);
  await setTextSetting(SITE_URL_KEY, value);
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
  const [mainHeaderEnabled, showNetworkSites] = await Promise.all([
    getBooleanSetting(MAIN_HEADER_ENABLED_KEY, true),
    getBooleanSetting(MAIN_HEADER_SHOW_NETWORK_SITES_KEY, false),
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
