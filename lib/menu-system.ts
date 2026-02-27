import type { MenuItem, MenuLocation } from "@/lib/kernel";
import { getSettingByKey, setSettingByKey } from "@/lib/settings-store";
import type { SitePermalinkSettings } from "@/lib/permalink";
import { buildArchivePath } from "@/lib/permalink";

function menuKey(siteId: string, location: MenuLocation) {
  return `site_${siteId}_menu_${location}`;
}

function safeParseMenu(raw: string | null | undefined) {
  if (!raw) return [] as MenuItem[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item?.label === "string" && typeof item?.href === "string")
      .map((item) => ({
        label: item.label.trim(),
        href: item.href.trim(),
        external: Boolean(item.external),
        order: typeof item.order === "number" ? item.order : undefined,
      })) as MenuItem[];
  } catch {
    return [];
  }
}

function isLegacyDefaultHeaderMenu(items: MenuItem[]) {
  const normalized = items
    .map((item) => ({
      label: item.label.trim().toLowerCase(),
      href: item.href.trim(),
      external: Boolean(item.external),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.href.localeCompare(b.href));

  const legacyDefault = [
    { label: "documentation", href: "/c/documentation", external: false },
    { label: "main site", href: "/", external: false },
  ].sort((a, b) => a.label.localeCompare(b.label) || a.href.localeCompare(b.href));

  const same = (a: Array<{ label: string; href: string; external: boolean }>) =>
    normalized.length === a.length &&
    normalized.every((item, idx) => item.label === a[idx].label && item.href === a[idx].href && item.external === a[idx].external);

  return same(legacyDefault);
}

export function defaultHeaderMenu(): MenuItem[] {
  return [
    { label: "Main Site", href: "/", order: 10 },
    { label: "Posts", href: "/posts", order: 20 },
  ];
}

export async function getSiteMenu(siteId: string, location: MenuLocation) {
  const value = await getSettingByKey(menuKey(siteId, location));
  const parsed = safeParseMenu(value);
  if (parsed.length > 0) {
    if (location === "header" && isLegacyDefaultHeaderMenu(parsed)) {
      return defaultHeaderMenu();
    }
    return parsed;
  }
  if (location === "header") return defaultHeaderMenu();
  return [];
}

export async function saveSiteMenu(siteId: string, location: MenuLocation, items: MenuItem[]) {
  const normalized = items
    .filter((item) => item.label && item.href)
    .map((item, index) => ({
      label: item.label.trim(),
      href: item.href.trim(),
      external: Boolean(item.external),
      order: item.order ?? (index + 1) * 10,
    }));

  await setSettingByKey(menuKey(siteId, location), JSON.stringify(normalized));
}

export async function saveSiteMenuFromJson(siteId: string, location: MenuLocation, rawJson: string) {
  const parsed = safeParseMenu(rawJson);
  await saveSiteMenu(siteId, location, parsed);
}

export function normalizeMenuItemsForPermalinks(items: MenuItem[], writing: SitePermalinkSettings) {
  return items.map((item) => {
    const href = String(item.href || "").trim();
    if (!href) return item;
    if (href === "/posts") {
      return { ...item, href: buildArchivePath("post", writing) };
    }
    if (href === "/pages") {
      return { ...item, href: buildArchivePath("page", writing) };
    }
    return item;
  });
}
