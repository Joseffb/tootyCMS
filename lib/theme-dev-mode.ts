import { unstable_noStore as noStore } from "next/cache";

const DEV_THEME_CACHE_CONTROL = "no-store, no-cache, must-revalidate";
const DEFAULT_THEME_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600";

export function isThemeDevDynamicMode() {
  return process.env.NODE_ENV === "development";
}

export function enableThemeDynamicRenderingInDev() {
  if (isThemeDevDynamicMode()) {
    noStore();
  }
}

export function getThemeAssetCacheControlHeader() {
  return isThemeDevDynamicMode() ? DEV_THEME_CACHE_CONTROL : DEFAULT_THEME_CACHE_CONTROL;
}

export function getThemeDevCacheBustToken() {
  return String(Date.now());
}
