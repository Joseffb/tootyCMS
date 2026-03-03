import db from "@/lib/db";
import { trace } from "@/lib/debug";
import type { MenuItem, MenuLocation } from "@/lib/kernel";
import type { SitePermalinkSettings } from "@/lib/permalink";
import { buildArchivePath } from "@/lib/permalink";
import {
  media,
  siteMenuItemMeta,
  siteMenuItems,
  siteMenus,
} from "@/lib/schema";
import { getSettingByKey, setSettingByKey } from "@/lib/settings-store";
import { and, asc, eq, inArray } from "drizzle-orm";

export type NativeMenuLocation = MenuLocation | "unassigned";

export type SiteMenuItemRecord = {
  id: string;
  menuId: string;
  parentId: string | null;
  title: string;
  href: string;
  description: string;
  mediaId: string;
  image: string;
  target: string;
  rel: string;
  external: boolean;
  enabled: boolean;
  sortOrder: number;
  meta: Record<string, string>;
};

export type SiteMenuDefinition = {
  id: string;
  siteId: string;
  key: string;
  title: string;
  description: string;
  location: NativeMenuLocation;
  sortOrder: number;
  items: SiteMenuItemRecord[];
};

type MenuMetaInput = Record<string, string>;

type UpsertMenuInput = {
  key: string;
  title: string;
  description?: string;
  location?: NativeMenuLocation;
  sortOrder?: number;
};

type UpsertMenuItemInput = {
  title: string;
  href: string;
  description?: string;
  parentId?: string;
  mediaId?: string;
  target?: string;
  rel?: string;
  external?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  meta?: MenuMetaInput;
};

const KNOWN_MENU_LOCATIONS: MenuLocation[] = ["header", "footer", "dashboard"];

function menuKey(siteId: string, location: MenuLocation) {
  return `site_${siteId}_menu_${location}`;
}

function normalizeLocation(location: string | null | undefined): NativeMenuLocation {
  const raw = String(location || "").trim().toLowerCase();
  if (!raw) return "unassigned";
  if (KNOWN_MENU_LOCATIONS.includes(raw as MenuLocation)) return raw as MenuLocation;
  return "unassigned";
}

function normalizeOrder(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMenuMeta(raw: Record<string, unknown> | null | undefined) {
  const next: Record<string, string> = {};
  if (!raw) return next;
  for (const [key, value] of Object.entries(raw)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;
    next[cleanKey] = String(value ?? "").trim();
  }
  return next;
}

export function parseMenuMetaJson(raw: string) {
  if (!raw.trim()) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return normalizeMenuMeta(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

function safeParseMenu(raw: string | null | undefined): MenuItem[] {
  if (!raw) return [] as MenuItem[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item?.label === "string" && typeof item?.href === "string")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id.trim() : undefined,
        label: item.label.trim(),
        href: item.href.trim(),
        description: typeof item.description === "string" ? item.description.trim() : "",
        image: typeof item.image === "string" ? item.image.trim() : "",
        mediaId:
          typeof item.mediaId === "string" || typeof item.mediaId === "number"
            ? String(item.mediaId).trim()
            : "",
        target: typeof item.target === "string" ? item.target.trim() : undefined,
        rel: typeof item.rel === "string" ? item.rel.trim() : undefined,
        external: Boolean(item.external),
        enabled: item.enabled !== false,
        order: typeof item.order === "number" ? item.order : undefined,
        meta:
          item.meta && typeof item.meta === "object" && !Array.isArray(item.meta)
            ? normalizeMenuMeta(item.meta as Record<string, unknown>)
            : undefined,
        children: Array.isArray(item.children)
          ? safeParseMenu(JSON.stringify(item.children))
          : undefined,
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
    normalized.every(
      (item, idx) =>
        item.label === a[idx].label &&
        item.href === a[idx].href &&
        item.external === a[idx].external,
    );

  return same(legacyDefault);
}

function isMissingMenuTablesError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("site_menus") || message.includes("site_menu_items") || message.includes("site_menu_item_meta");
}

type MutableMenuNode = MenuItem & { __children: MutableMenuNode[] };

function toMenuTree(records: SiteMenuItemRecord[]): MenuItem[] {
  const ordered = [...records].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const byId = new Map<string, MutableMenuNode>();
  const roots: MutableMenuNode[] = [];

  for (const item of ordered) {
    byId.set(item.id, {
      id: item.id,
      label: item.title,
      href: item.href,
      description: item.description || undefined,
      image: item.image || undefined,
      mediaId: item.mediaId || undefined,
      target: item.target || undefined,
      rel: item.rel || undefined,
      external: item.external,
      enabled: item.enabled,
      order: item.sortOrder,
      meta: Object.keys(item.meta).length ? item.meta : undefined,
      __children: [],
    });
  }

  for (const item of ordered) {
    const current = byId.get(item.id);
    if (!current) continue;
    const parent = item.parentId ? byId.get(item.parentId) : null;
    if (parent) {
      parent.__children.push(current);
      continue;
    }
    roots.push(current);
  }

  const finalize = (node: MutableMenuNode): MenuItem => {
    const { __children, ...rest } = node;
    return {
      ...rest,
      children: __children.length ? __children.map(finalize) : undefined,
    };
  };

  return roots.filter((item) => item.enabled !== false).map(finalize);
}

function flattenMenuItemsForLegacy(items: MenuItem[], depth = 0): MenuItem[] {
  return items.flatMap((item, index) => {
    const current: MenuItem = {
      label: item.label,
      href: item.href,
      description: item.description,
      image: item.image,
      mediaId: item.mediaId,
      target: item.target,
      rel: item.rel,
      external: Boolean(item.external),
      enabled: item.enabled !== false,
      order: item.order ?? (index + 1) * 10,
      meta: item.meta,
    };
    const children = Array.isArray(item.children) ? flattenMenuItemsForLegacy(item.children, depth + 1) : [];
    return [current, ...children];
  });
}

async function listNativeSiteMenus(siteId: string): Promise<SiteMenuDefinition[]> {
  try {
    const menus = await db.query.siteMenus.findMany({
      where: eq(siteMenus.siteId, siteId),
      orderBy: (table, { asc }) => [asc(table.sortOrder), asc(table.createdAt)],
    });

    if (!menus.length) return [];

    const menuIds = menus.map((menu) => menu.id);
    const items = await db.query.siteMenuItems.findMany({
      where: inArray(siteMenuItems.menuId, menuIds),
      orderBy: (table, { asc }) => [asc(table.sortOrder), asc(table.createdAt)],
    });

    const itemIds = items.map((item) => item.id);
    const mediaIds = Array.from(
      new Set(items.map((item) => item.mediaId).filter((value): value is number => typeof value === "number")),
    );

    const [metaRows, mediaRows] = await Promise.all([
      itemIds.length
        ? db.query.siteMenuItemMeta.findMany({
            where: inArray(siteMenuItemMeta.menuItemId, itemIds),
            orderBy: (table, { asc }) => [asc(table.id)],
          })
        : Promise.resolve([]),
      mediaIds.length
        ? db.query.media.findMany({
            where: inArray(media.id, mediaIds),
          })
        : Promise.resolve([]),
    ]);

    const mediaById = new Map(mediaRows.map((row) => [String(row.id), row]));
    const metaByItemId = new Map<string, Record<string, string>>();
    for (const row of metaRows) {
      const existing = metaByItemId.get(row.menuItemId) || {};
      existing[row.key] = row.value;
      metaByItemId.set(row.menuItemId, existing);
    }

    const itemsByMenuId = new Map<string, SiteMenuItemRecord[]>();
    for (const item of items) {
      const record: SiteMenuItemRecord = {
        id: item.id,
        menuId: item.menuId,
        parentId: item.parentId || null,
        title: item.title,
        href: item.href,
        description: item.description || "",
        mediaId: item.mediaId ? String(item.mediaId) : "",
        image: item.mediaId ? mediaById.get(String(item.mediaId))?.url || "" : "",
        target: item.target || "",
        rel: item.rel || "",
        external: Boolean(item.external),
        enabled: item.enabled !== false,
        sortOrder: item.sortOrder,
        meta: metaByItemId.get(item.id) || {},
      };
      const current = itemsByMenuId.get(item.menuId) || [];
      current.push(record);
      itemsByMenuId.set(item.menuId, current);
    }

    return menus.map((menu) => ({
      id: menu.id,
      siteId: menu.siteId,
      key: menu.key,
      title: menu.title,
      description: menu.description || "",
      location: normalizeLocation(menu.location),
      sortOrder: menu.sortOrder,
      items: (itemsByMenuId.get(menu.id) || []).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
      ),
    }));
  } catch (error) {
    if (isMissingMenuTablesError(error)) {
      trace("menu", "native menu tables unavailable, falling back to legacy settings", { siteId });
      return [];
    }
    throw error;
  }
}

async function listNativeSiteMenuTree(siteId: string, location: MenuLocation) {
  const menus = await listNativeSiteMenus(siteId);
  const target = menus
    .filter((menu) => menu.location === location)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))[0];
  if (!target) return [];
  return toMenuTree(target.items);
}

function normalizeLocationForStorage(location: NativeMenuLocation) {
  return location === "unassigned" ? null : location;
}

async function clearDuplicateLocationAssignments(siteId: string, location: NativeMenuLocation, keepMenuId?: string) {
  if (location === "unassigned") return;
  const where = keepMenuId
    ? and(eq(siteMenus.siteId, siteId), eq(siteMenus.location, location))
    : and(eq(siteMenus.siteId, siteId), eq(siteMenus.location, location));
  const rows = await db.query.siteMenus.findMany({
    where,
  });
  const duplicates = rows.filter((row) => row.id !== keepMenuId);
  if (!duplicates.length) return;
  await Promise.all(
    duplicates.map((row) =>
      db.update(siteMenus).set({ location: null }).where(eq(siteMenus.id, row.id)),
    ),
  );
}

export function defaultHeaderMenu(): MenuItem[] {
  return [
    { label: "Main Site", href: "/", order: 10 },
    { label: "Posts", href: "/posts", order: 20 },
  ];
}

export async function listSiteMenus(siteId: string) {
  return listNativeSiteMenus(siteId);
}

export async function getSiteMenuDefinition(siteId: string, menuId: string) {
  const menus = await listNativeSiteMenus(siteId);
  return menus.find((menu) => menu.id === menuId) || null;
}

export async function getSiteMenu(siteId: string, location: MenuLocation) {
  const nativeMenu = await listNativeSiteMenuTree(siteId, location);
  if (nativeMenu.length > 0) return nativeMenu;

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

export async function createSiteMenu(siteId: string, input: UpsertMenuInput) {
  const key = input.key.trim();
  const title = input.title.trim();
  const location = normalizeLocation(input.location);
  if (!key || !title) throw new Error("Menu key and title are required.");

  const [created] = await db
    .insert(siteMenus)
    .values({
      siteId,
      key,
      title,
      description: String(input.description || "").trim(),
      location: normalizeLocationForStorage(location),
      sortOrder: normalizeOrder(input.sortOrder, 10),
    })
    .returning();

  await clearDuplicateLocationAssignments(siteId, location, created.id);
  return created;
}

export async function updateSiteMenu(siteId: string, menuId: string, input: UpsertMenuInput) {
  const key = input.key.trim();
  const title = input.title.trim();
  const location = normalizeLocation(input.location);
  if (!key || !title) throw new Error("Menu key and title are required.");

  const [updated] = await db
    .update(siteMenus)
    .set({
      key,
      title,
      description: String(input.description || "").trim(),
      location: normalizeLocationForStorage(location),
      sortOrder: normalizeOrder(input.sortOrder, 10),
    })
    .where(and(eq(siteMenus.id, menuId), eq(siteMenus.siteId, siteId)))
    .returning();

  if (!updated) throw new Error("Menu not found.");
  await clearDuplicateLocationAssignments(siteId, location, updated.id);
  return updated;
}

export async function deleteSiteMenu(siteId: string, menuId: string) {
  await db.delete(siteMenus).where(and(eq(siteMenus.id, menuId), eq(siteMenus.siteId, siteId)));
}

export async function createSiteMenuItem(siteId: string, menuId: string, input: UpsertMenuItemInput) {
  const menu = await db.query.siteMenus.findFirst({
    where: and(eq(siteMenus.id, menuId), eq(siteMenus.siteId, siteId)),
    columns: { id: true },
  });
  if (!menu) throw new Error("Menu not found.");

  const [created] = await db
    .insert(siteMenuItems)
    .values({
      menuId,
      parentId: input.parentId || null,
      title: input.title.trim(),
      href: input.href.trim(),
      description: String(input.description || "").trim(),
      mediaId: input.mediaId ? Number(input.mediaId) : null,
      target: String(input.target || "").trim() || null,
      rel: String(input.rel || "").trim() || null,
      external: Boolean(input.external),
      enabled: input.enabled !== false,
      sortOrder: normalizeOrder(input.sortOrder, 10),
    })
    .returning();

  const meta = normalizeMenuMeta(input.meta);
  const rows = Object.entries(meta).map(([key, value]) => ({
    menuItemId: created.id,
    key,
    value,
  }));
  if (rows.length) await db.insert(siteMenuItemMeta).values(rows);
  return created;
}

export async function updateSiteMenuItem(siteId: string, menuId: string, itemId: string, input: UpsertMenuItemInput) {
  const menu = await db.query.siteMenus.findFirst({
    where: and(eq(siteMenus.id, menuId), eq(siteMenus.siteId, siteId)),
    columns: { id: true },
  });
  if (!menu) throw new Error("Menu not found.");

  const [updated] = await db
    .update(siteMenuItems)
    .set({
      parentId: input.parentId || null,
      title: input.title.trim(),
      href: input.href.trim(),
      description: String(input.description || "").trim(),
      mediaId: input.mediaId ? Number(input.mediaId) : null,
      target: String(input.target || "").trim() || null,
      rel: String(input.rel || "").trim() || null,
      external: Boolean(input.external),
      enabled: input.enabled !== false,
      sortOrder: normalizeOrder(input.sortOrder, 10),
    })
    .where(and(eq(siteMenuItems.id, itemId), eq(siteMenuItems.menuId, menuId)))
    .returning();

  if (!updated) throw new Error("Menu item not found.");

  await db.delete(siteMenuItemMeta).where(eq(siteMenuItemMeta.menuItemId, itemId));
  const meta = normalizeMenuMeta(input.meta);
  const rows = Object.entries(meta).map(([key, value]) => ({
    menuItemId: itemId,
    key,
    value,
  }));
  if (rows.length) await db.insert(siteMenuItemMeta).values(rows);

  return updated;
}

export async function deleteSiteMenuItem(siteId: string, menuId: string, itemId: string) {
  const menu = await db.query.siteMenus.findFirst({
    where: and(eq(siteMenus.id, menuId), eq(siteMenus.siteId, siteId)),
    columns: { id: true },
  });
  if (!menu) return;
  await db.delete(siteMenuItems).where(and(eq(siteMenuItems.id, itemId), eq(siteMenuItems.menuId, menuId)));
}

export async function saveSiteMenu(siteId: string, location: MenuLocation, items: MenuItem[]) {
  const normalized = flattenMenuItemsForLegacy(items)
    .filter((item) => item.label && item.href)
    .map((item, index) => ({
      label: item.label.trim(),
      href: item.href.trim(),
      description: String(item.description || "").trim(),
      image: String(item.image || "").trim(),
      mediaId: String(item.mediaId || "").trim(),
      target: String(item.target || "").trim(),
      rel: String(item.rel || "").trim(),
      external: Boolean(item.external),
      enabled: item.enabled !== false,
      order: item.order ?? (index + 1) * 10,
      meta: item.meta ? normalizeMenuMeta(item.meta) : undefined,
    }));

  await setSettingByKey(menuKey(siteId, location), JSON.stringify(normalized));
}

export async function saveSiteMenuFromJson(siteId: string, location: MenuLocation, rawJson: string) {
  const parsed = safeParseMenu(rawJson);
  await saveSiteMenu(siteId, location, parsed);
}

export function normalizeMenuItemsForPermalinks(
  items: MenuItem[],
  writing: SitePermalinkSettings,
): MenuItem[] {
  return items.map((item) => {
    const href = String(item.href || "").trim();
    if (!href) return item;
    const nextChildren = Array.isArray(item.children)
      ? normalizeMenuItemsForPermalinks(item.children, writing)
      : undefined;

    if (href === "/posts") {
      return { ...item, href: buildArchivePath("post", writing), children: nextChildren };
    }
    if (href === "/pages") {
      return { ...item, href: buildArchivePath("page", writing), children: nextChildren };
    }
    return { ...item, children: nextChildren };
  });
}
