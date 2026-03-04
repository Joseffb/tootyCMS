import type { MenuLocation } from "@/lib/kernel";
import {
  buildSiteMenuItemTree,
  NATIVE_MENU_LOCATIONS,
  createSiteMenu,
  createSiteMenuItem,
  deleteSiteMenu,
  deleteSiteMenuItem,
  getSiteMenu,
  getSiteMenuDefinitionByKey,
  getSiteMenuItemDefinitionById,
  listSiteMenus,
  type UpsertMenuInput,
  type UpsertMenuItemInput,
  updateSiteMenu,
  updateSiteMenuItem,
} from "@/lib/menu-system";

export function normalizeCoreMenuLocation(value: string): MenuLocation | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return NATIVE_MENU_LOCATIONS.includes(normalized as MenuLocation) ? (normalized as MenuLocation) : null;
}

export async function listCoreMenus(siteId: string) {
  return listSiteMenus(siteId);
}

export async function getCoreMenuByKey(siteId: string, menuKey: string) {
  return getSiteMenuDefinitionByKey(siteId, menuKey);
}

export async function createCoreMenu(siteId: string, input: UpsertMenuInput) {
  return createSiteMenu(siteId, input);
}

export async function updateCoreMenuByKey(siteId: string, menuKey: string, input: UpsertMenuInput) {
  const menu = await getSiteMenuDefinitionByKey(siteId, menuKey);
  if (!menu) throw new Error("Menu not found.");
  return updateSiteMenu(siteId, menu.id, input);
}

export async function deleteCoreMenuByKey(siteId: string, menuKey: string) {
  const menu = await getSiteMenuDefinitionByKey(siteId, menuKey);
  if (!menu) throw new Error("Menu not found.");
  await deleteSiteMenu(siteId, menu.id);
  return { ok: true as const };
}

export async function getCoreMenuByLocation(siteId: string, location: string) {
  const normalized = normalizeCoreMenuLocation(location);
  if (!normalized) throw new Error("Invalid menu location.");
  return getSiteMenu(siteId, normalized);
}

export async function getCoreMenuDefinitionByLocation(siteId: string, location: string) {
  const normalized = normalizeCoreMenuLocation(location);
  if (!normalized) throw new Error("Invalid menu location.");

  const menus = await listSiteMenus(siteId);
  const assigned = menus
    .filter((menu) => menu.location === normalized)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];

  if (assigned) {
    return {
      ...assigned,
      items: buildSiteMenuItemTree(assigned.items),
      flatItems: assigned.items,
    };
  }

  const fallbackItems = await getSiteMenu(siteId, normalized);
  return {
    id: "",
    siteId,
    key: normalized,
    title: `${normalized[0]?.toUpperCase() || ""}${normalized.slice(1)} Menu`,
    description: "",
    location: normalized,
    sortOrder: 10,
    items: fallbackItems,
    flatItems: fallbackItems,
  };
}

export async function listCoreMenuItems(siteId: string, menuKey: string) {
  const menu = await getSiteMenuDefinitionByKey(siteId, menuKey);
  if (!menu) throw new Error("Menu not found.");
  return menu.items;
}

export async function getCoreMenuItem(siteId: string, menuKey: string, itemId: string) {
  const item = await getSiteMenuItemDefinitionById(siteId, menuKey, itemId);
  if (!item) throw new Error("Menu item not found.");
  return item;
}

export async function createCoreMenuItem(siteId: string, menuKey: string, input: UpsertMenuItemInput) {
  const menu = await getSiteMenuDefinitionByKey(siteId, menuKey);
  if (!menu) throw new Error("Menu not found.");
  return createSiteMenuItem(siteId, menu.id, input);
}

export async function updateCoreMenuItem(siteId: string, menuKey: string, itemId: string, input: UpsertMenuItemInput) {
  const menu = await getSiteMenuDefinitionByKey(siteId, menuKey);
  if (!menu) throw new Error("Menu not found.");
  const item = await getSiteMenuItemDefinitionById(siteId, menuKey, itemId);
  if (!item) throw new Error("Menu item not found.");
  return updateSiteMenuItem(siteId, menu.id, item.id, input);
}

export async function deleteCoreMenuItem(siteId: string, menuKey: string, itemId: string) {
  const menu = await getSiteMenuDefinitionByKey(siteId, menuKey);
  if (!menu) throw new Error("Menu not found.");
  const item = await getSiteMenuItemDefinitionById(siteId, menuKey, itemId);
  if (!item) throw new Error("Menu item not found.");
  await deleteSiteMenuItem(siteId, menu.id, item.id);
  return { ok: true as const };
}
