import { getSession } from "@/lib/auth";
import { getAdminPathAlias } from "@/lib/admin-path";
import {
  type SiteMenuDefinition,
  createSiteMenu,
  createSiteMenuItem,
  deleteSiteMenu,
  deleteSiteMenuItem,
  getSiteMenuDefinition,
  listSiteMenus,
  parseMenuMetaJson,
  updateSiteMenu,
  updateSiteMenuItem,
} from "@/lib/menu-system";
import { applyPendingDatabaseMigrations, getDatabaseHealthReport } from "@/lib/db-health";
import { notFound, redirect } from "next/navigation";
import { getAuthorizedSiteForUser, userCan } from "@/lib/authorization";
import { revalidatePath } from "next/cache";
import MediaPickerField from "@/components/media/media-picker-field";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    menu?: string | string[];
    item?: string | string[];
    createMenu?: string | string[];
    editMenu?: string | string[];
    createItem?: string | string[];
    editItem?: string | string[];
  }>;
};

const MENU_LOCATIONS = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "dashboard", label: "Dashboard" },
  { value: "unassigned", label: "Unassigned" },
] as const;

function toMenuKeyFragment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function assignMenuKey(siteId: string, title: string, currentMenu?: SiteMenuDefinition | null) {
  const existingMenus = await listSiteMenus(siteId);
  const currentKey = currentMenu?.key?.trim();
  if (currentKey) return currentKey;

  const base = toMenuKeyFragment(title) || "menu";
  const used = new Set(existingMenus.map((menu) => menu.key.trim()).filter(Boolean));
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function stringParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function menuSettingsHref(adminBasePath: string, siteId: string, menuId?: string, itemId?: string) {
  const url = new URL(`http://tooty.local${adminBasePath}/site/${siteId}/settings/menus`);
  if (menuId) url.searchParams.set("menu", menuId);
  if (itemId) url.searchParams.set("item", itemId);
  return `${url.pathname}${url.search}`;
}

function buildMenuSettingsHref(
  adminBasePath: string,
  siteId: string,
  options: {
    menu?: string;
    item?: string;
    createMenu?: boolean;
    editMenu?: string;
    createItem?: boolean;
    editItem?: string;
  } = {},
) {
  const url = new URL(`http://tooty.local${adminBasePath}/site/${siteId}/settings/menus`);
  if (options.menu) url.searchParams.set("menu", options.menu);
  if (options.item) url.searchParams.set("item", options.item);
  if (options.createMenu) url.searchParams.set("createMenu", "1");
  if (options.editMenu) url.searchParams.set("editMenu", options.editMenu);
  if (options.createItem) url.searchParams.set("createItem", "1");
  if (options.editItem) url.searchParams.set("editItem", options.editItem);
  return `${url.pathname}${url.search}`;
}

function revalidateMenuPaths(siteId: string) {
  revalidatePath(`/site/${siteId}/settings/menus`);
  revalidatePath(`/app/site/${siteId}/settings/menus`);
  revalidatePath("/", "layout");
  revalidatePath("/[domain]", "layout");
  revalidatePath("/[domain]/posts", "page");
  revalidatePath("/[domain]/[slug]", "page");
  revalidatePath("/[domain]/[slug]/[child]", "page");
  revalidatePath("/[domain]/c/[slug]", "page");
  revalidatePath("/[domain]/t/[slug]", "page");
}

function nativeMenuTablesMissing(report: Awaited<ReturnType<typeof getDatabaseHealthReport>>) {
  return report.missingTables.some((table) =>
    ["site_menus", "site_menu_items", "site_menu_item_meta"].some((suffix) => table.endsWith(suffix)),
  );
}

export default async function SiteMenuSettingsPage({ params, searchParams }: Props) {
  const adminBasePath = `/app/${getAdminPathAlias()}`;
  const session = await getSession();
  if (!session) redirect("/login");

  const id = decodeURIComponent((await params).id);
  const site = await getAuthorizedSiteForUser(session.user.id, id, "site.menus.manage");
  if (!site) notFound();
  const siteData = site;

  const dbHealth = await getDatabaseHealthReport();
  const menusReady = !nativeMenuTablesMissing(dbHealth);
  const query = searchParams ? await searchParams : {};
  const menus = await listSiteMenus(siteData.id);
  const createMenuRequested = stringParam(query.createMenu) === "1";
  const editMenuId = stringParam(query.editMenu);
  const selectedMenuId = stringParam(query.menu) || editMenuId;
  const createItemRequested = stringParam(query.createItem) === "1";
  const editItemId = stringParam(query.editItem);
  const selectedMenu = selectedMenuId
    ? menus.find((menu) => menu.id === selectedMenuId) || (await getSiteMenuDefinition(siteData.id, selectedMenuId))
    : null;
  const selectedItemId = stringParam(query.item) || editItemId;
  const selectedItem = selectedMenu?.items.find((item) => item.id === selectedItemId) || null;
  const editingMenu = editMenuId
    ? menus.find((menu) => menu.id === editMenuId) || (selectedMenu?.id === editMenuId ? selectedMenu : null)
    : null;
  const editingItem = editItemId
    ? selectedMenu?.items.find((item) => item.id === editItemId) || (selectedItem?.id === editItemId ? selectedItem : null)
    : null;
  const showMenuForm = createMenuRequested || Boolean(editingMenu);
  const showItemForm = Boolean(selectedMenu) && (createItemRequested || Boolean(editingItem));

  async function ensureAllowed() {
    "use server";
    const activeSession = await getSession();
    if (!activeSession?.user?.id) redirect("/login");
    const allowed = await userCan("site.menus.manage", activeSession.user.id, { siteId: siteData.id });
    if (!allowed) redirect(adminBasePath);
  }

  async function ensureNativeMenuTablesAvailable() {
    "use server";
    let report = await getDatabaseHealthReport();
    if (!nativeMenuTablesMissing(report)) return;
    await applyPendingDatabaseMigrations();
    report = await getDatabaseHealthReport();
    if (nativeMenuTablesMissing(report)) redirect(`${adminBasePath}/settings/database`);
  }

  async function saveMenuAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    await ensureNativeMenuTablesAvailable();
    const menuId = String(formData.get("menu_id") || "").trim();
    const editingRecord = menuId ? await getSiteMenuDefinition(siteData.id, menuId) : null;
    const title = String(formData.get("title") || "").trim();
    const payload = {
      key: await assignMenuKey(siteData.id, title, editingRecord),
      title,
      description: String(formData.get("description") || "").trim(),
      location: String(formData.get("location") || "unassigned").trim() as
        | "header"
        | "footer"
        | "dashboard"
        | "unassigned",
      sortOrder: Number(formData.get("sortOrder") || 10),
    };

    const record = menuId
      ? await updateSiteMenu(siteData.id, menuId, payload)
      : await createSiteMenu(siteData.id, payload);

    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(adminBasePath, siteData.id, record.id));
  }

  async function deleteMenuAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    await ensureNativeMenuTablesAvailable();
    const menuId = String(formData.get("menu_id") || "").trim();
    const expected = String(formData.get("confirm_expected") || "").trim();
    const received = String(formData.get("confirm_value") || "").trim();
    if (!menuId) redirect(menuSettingsHref(adminBasePath, siteData.id));
    if (!expected || received !== expected) throw new Error("Delete confirmation did not match.");
    await deleteSiteMenu(siteData.id, menuId);
    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(adminBasePath, siteData.id));
  }

  async function saveItemAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    await ensureNativeMenuTablesAvailable();
    const menuId = String(formData.get("menu_id") || "").trim();
    if (!menuId) redirect(menuSettingsHref(adminBasePath, siteData.id));
    const itemId = String(formData.get("item_id") || "").trim();
    const payload = {
      title: String(formData.get("title") || "").trim(),
      href: String(formData.get("href") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      parentId: String(formData.get("parentId") || "").trim(),
      mediaId: String(formData.get("image_media_id") || "").trim(),
      target: String(formData.get("target") || "").trim(),
      rel: String(formData.get("rel") || "").trim(),
      external: formData.get("external") === "on",
      enabled: formData.get("enabled") === "on",
      sortOrder: Number(formData.get("sortOrder") || 10),
      meta: parseMenuMetaJson(String(formData.get("meta") || "")),
    };

    const record = itemId
      ? await updateSiteMenuItem(siteData.id, menuId, itemId, payload)
      : await createSiteMenuItem(siteData.id, menuId, payload);

    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(adminBasePath, siteData.id, menuId, record.id));
  }

  async function deleteItemAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    await ensureNativeMenuTablesAvailable();
    const menuId = String(formData.get("menu_id") || "").trim();
    const itemId = String(formData.get("item_id") || "").trim();
    const expected = String(formData.get("confirm_expected") || "").trim();
    const received = String(formData.get("confirm_value") || "").trim();
    if (!menuId || !itemId) redirect(menuSettingsHref(adminBasePath, siteData.id, menuId));
    if (!expected || received !== expected) throw new Error("Delete confirmation did not match.");
    await deleteSiteMenuItem(siteData.id, menuId, itemId);
    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(adminBasePath, siteData.id, menuId));
  }

  const selectedMenuSettingsHref = selectedMenu
    ? menuSettingsHref(adminBasePath, siteData.id, selectedMenu.id)
    : menuSettingsHref(adminBasePath, siteData.id);
  const showDetailView = Boolean(selectedMenu);
  const showListWorkspace = menusReady && !showDetailView;
  const showDetailMissingNotice = Boolean(selectedMenuId) && !selectedMenu;
  const renderMenuForm = showMenuForm ? (
    <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-cal text-xl text-black dark:text-white">{editingMenu ? "Edit Menu" : "Create Menu"}</h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Menus are location-aware sets. Themes consume them through the existing menu API.
          </p>
        </div>
        <Link
          href={menuSettingsHref(adminBasePath, siteData.id, selectedMenu?.id)}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
        >
          Close
        </Link>
      </div>
      <form action={saveMenuAction} className="mt-4 grid gap-4">
        <input type="hidden" name="menu_id" value={editingMenu?.id || ""} />
        <label className="grid gap-2 text-sm text-black dark:text-white">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Title</span>
          <input
            name="title"
            defaultValue={editingMenu?.title || ""}
            className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
            required
          />
        </label>
        {editingMenu?.key ? (
          <div className="grid gap-1 text-sm text-black dark:text-white">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
              Assigned Key
            </span>
            <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-200">
              {editingMenu.key}
            </div>
            <span className="text-[11px] text-stone-500 dark:text-stone-400">
              Stable handle used for menu assignment and theme lookup.
            </span>
          </div>
        ) : null}
        <label className="grid gap-2 text-sm text-black dark:text-white">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Description</span>
          <textarea
            name="description"
            defaultValue={editingMenu?.description || ""}
            rows={3}
            className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-black dark:text-white">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Location</span>
            <select
              name="location"
              defaultValue={editingMenu?.location || "unassigned"}
              className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
            >
              {MENU_LOCATIONS.map((location) => (
                <option key={location.value} value={location.value}>
                  {location.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-black dark:text-white">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Sort Order</span>
            <input
              type="number"
              name="sortOrder"
              defaultValue={editingMenu?.sortOrder ?? 10}
              className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-md border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-white hover:text-black">
            {editingMenu ? "Save Menu" : "Create Menu"}
          </button>
        </div>
      </form>
      {editingMenu ? (
        <form action={deleteMenuAction} className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
          <input type="hidden" name="menu_id" value={editingMenu.id} />
          <input type="hidden" name="confirm_expected" value={editingMenu.key} />
          <div className="text-sm font-semibold text-red-700 dark:text-red-300">Delete Menu</div>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Type <code>{editingMenu.key}</code> to permanently remove this menu and its items.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              name="confirm_value"
              className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-black"
              placeholder={editingMenu.key}
            />
            <button className="rounded-md border border-red-700 bg-red-700 px-3 py-2 text-sm font-semibold text-white">
              Delete Menu
            </button>
          </div>
        </form>
      ) : null}
    </section>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      {showDetailView ? (
        <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <h1 className="font-cal text-2xl text-black dark:text-white">{selectedMenu?.title}</h1>
              <p className="max-w-3xl text-sm text-stone-600 dark:text-stone-400">
                {selectedMenu?.description?.trim()
                  ? selectedMenu.description
                  : "Manage this menu’s items, images, descriptions, and extension-ready metadata."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <Link
                href={menuSettingsHref(adminBasePath, siteData.id)}
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
              >
                Back to Menus
              </Link>
              {menusReady ? (
                <>
                  <Link
                    href={buildMenuSettingsHref(adminBasePath, siteData.id, { menu: selectedMenu?.id, editMenu: selectedMenu?.id })}
                    className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                  >
                    Edit Menu
                  </Link>
                </>
              ) : (
                <Link
                  href={`${adminBasePath}/settings/database`}
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
                >
                  Open Database Updates
                </Link>
              )}
            </div>
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="font-cal text-2xl text-black dark:text-white">Site Menus</h1>
          <p className="max-w-3xl text-sm text-stone-600 dark:text-stone-400">
            Built-in menus are native to Tooty. Each site can manage multiple menus, assign them to locations,
            and attach rich item data such as descriptions, images, and extension-friendly meta fields.
          </p>
        </div>
      )}

      {!menusReady ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-cal text-xl text-amber-950 dark:text-amber-200">Native Menus Need a Database Update</h2>
              <p className="mt-1 max-w-3xl text-sm text-amber-900/80 dark:text-amber-200/80">
                The native menu spine tables are not installed yet, so menu reads are falling back to legacy settings.
                Apply the database update before creating or editing menus.
              </p>
            </div>
            <Link
              href={`${adminBasePath}/settings/database`}
              className="rounded-md border border-amber-900 bg-amber-900 px-3 py-2 text-xs font-semibold text-white"
            >
              Open Database Updates
            </Link>
          </div>
        </section>
      ) : null}

      {showDetailMissingNotice ? (
        <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-cal text-xl text-black dark:text-white">Selected Menu Not Available</h2>
              <p className="mt-1 max-w-3xl text-sm text-stone-600 dark:text-stone-400">
                The requested menu could not be loaded. It may have been removed, or native menu tables are not available yet.
              </p>
            </div>
            <Link
              href={menuSettingsHref(adminBasePath, siteData.id)}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
            >
              Back to Menus
            </Link>
          </div>
        </section>
      ) : null}

      {showListWorkspace || showDetailView ? (
      <div className={`grid gap-6 ${showDetailView ? "" : "xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]"}`}>
        {showListWorkspace ? (
        <div className="grid gap-6">
          <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">Menus</h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Click a row to manage that menu’s items.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-stone-500 dark:text-stone-400">{menus.length} total</div>
                {menusReady ? (
                  <Link
                    href={buildMenuSettingsHref(adminBasePath, siteData.id, { createMenu: true })}
                    className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-white hover:text-black"
                  >
                    Add Menu
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-700">
                  <thead className="bg-stone-50 dark:bg-stone-900/30">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Menu</th>
                    <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Location</th>
                    <th className="px-3 py-2 text-right font-semibold text-stone-600 dark:text-stone-300">Items</th>
                    <th className="px-3 py-2 text-right font-semibold text-stone-600 dark:text-stone-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                  {menus.map((menu) => {
                    const isActive = selectedMenu?.id === menu.id;
                    const menuHref = menuSettingsHref(adminBasePath, siteData.id, menu.id);
                    return (
                      <tr key={menu.id} className={isActive ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                        <td className="px-3 py-2">
                          <Link href={menuHref} className="block rounded-sm focus:outline-none focus:ring-2 focus:ring-black/30">
                            <div className="font-medium text-stone-900 dark:text-white">{menu.title}</div>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-stone-600 dark:text-stone-300">
                          <Link href={menuHref} className="block rounded-sm focus:outline-none focus:ring-2 focus:ring-black/30">
                            {menu.location === "unassigned" ? "Unassigned" : menu.location}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">
                          <Link href={menuHref} className="block rounded-sm focus:outline-none focus:ring-2 focus:ring-black/30">
                            {menu.items.length}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={buildMenuSettingsHref(adminBasePath, siteData.id, { menu: menu.id, editMenu: menu.id })}
                              aria-label={`Edit menu ${menu.title}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-sm font-semibold text-black"
                            >
                              ✎
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {menus.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-stone-500 dark:text-stone-400">
                        {menusReady ? "No native menus yet." : "Native menu tables are not installed yet."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          {renderMenuForm}
        </div>
        ) : null}

        <div className="grid gap-6">
          {showDetailView ? renderMenuForm : null}
          {selectedMenu ? (
          <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">Menu Items</h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Rich menu items support descriptions, media, and extension-ready meta fields.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  {selectedMenu ? `${selectedMenu.items.length} items` : "Select a menu"}
                </div>
                {selectedMenu && menusReady ? (
                  <Link
                    href={buildMenuSettingsHref(adminBasePath, siteData.id, {
                      menu: selectedMenu.id,
                      item: selectedItem?.id,
                      createItem: true,
                    })}
                    className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-white hover:text-black"
                  >
                    Add Item
                  </Link>
                ) : null}
              </div>
            </div>
              <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-700">
                  <thead className="bg-stone-50 dark:bg-stone-900/30">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Item</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Parent</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Link</th>
                      <th className="px-3 py-2 text-right font-semibold text-stone-600 dark:text-stone-300">Order</th>
                      <th className="px-3 py-2 text-right font-semibold text-stone-600 dark:text-stone-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                    {selectedMenu.items.map((item) => {
                      const isActive = selectedItem?.id === item.id;
                      const parent = item.parentId
                        ? selectedMenu.items.find((entry) => entry.id === item.parentId)?.title || "Unknown"
                        : "Root";
                      const itemHref = menuSettingsHref(adminBasePath, siteData.id, selectedMenu.id, item.id);
                      return (
                        <tr key={item.id} className={isActive ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                          <td className="px-3 py-2">
                            <Link href={itemHref} className="block rounded-sm focus:outline-none focus:ring-2 focus:ring-black/30">
                              <div className="font-medium text-stone-900 dark:text-white">{item.title}</div>
                              {item.description ? (
                                <div className="truncate text-xs text-stone-500 dark:text-stone-400">{item.description}</div>
                              ) : null}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-stone-600 dark:text-stone-300">
                            <Link href={itemHref} className="block rounded-sm focus:outline-none focus:ring-2 focus:ring-black/30">
                              {parent}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <Link href={itemHref} className="block truncate rounded-sm text-xs text-stone-500 focus:outline-none focus:ring-2 focus:ring-black/30 dark:text-stone-400">
                              {item.href}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">
                            <Link href={itemHref} className="block rounded-sm focus:outline-none focus:ring-2 focus:ring-black/30">
                              {item.sortOrder}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={buildMenuSettingsHref(adminBasePath, siteData.id, {
                                  menu: selectedMenu.id,
                                  item: item.id,
                                  editItem: item.id,
                                })}
                                aria-label={`Edit menu item ${item.title}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-sm font-semibold text-black"
                              >
                                ✎
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {selectedMenu.items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-stone-500 dark:text-stone-400">
                          No items in this menu yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
          </section>
          ) : null}

          {showItemForm ? (
            <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">
                  {editingItem ? "Edit Menu Item" : "Create Menu Item"}
                </h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Menu items are content-like records with image and expansion-ready metadata.
                </p>
              </div>
              {selectedMenu ? (
                <Link
                  href={selectedMenuSettingsHref}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                >
                  Close
                </Link>
              ) : null}
            </div>

            {selectedMenu ? (
              <>
                <form action={saveItemAction} className="mt-4 grid gap-4">
                  <input type="hidden" name="menu_id" value={selectedMenu.id} />
                  <input type="hidden" name="item_id" value={editingItem?.id || ""} />
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Title</span>
                    <input
                      name="title"
                      defaultValue={editingItem?.title || ""}
                      className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                      required
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Link</span>
                    <input
                      name="href"
                      defaultValue={editingItem?.href || ""}
                      className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                      placeholder="/posts"
                      required
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Description</span>
                    <textarea
                      name="description"
                      defaultValue={editingItem?.description || ""}
                      rows={3}
                      className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                    />
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <MediaPickerField
                      siteId={siteData.id}
                      name="item_image"
                      companionMediaIdName="image_media_id"
                      label="Image"
                      valueMode="url"
                      initialValue={editingItem?.image || ""}
                      initialMediaId={editingItem?.mediaId || ""}
                      initialUrl={editingItem?.image || ""}
                      initialLabel={editingItem?.title || ""}
                    />
                    <div className="grid gap-4">
                      <label className="grid gap-2 text-sm text-black dark:text-white">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Parent Item</span>
                        <select
                          name="parentId"
                          defaultValue={editingItem?.parentId || ""}
                          className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        >
                          <option value="">Root Item</option>
                          {selectedMenu.items
                            .filter((item) => item.id !== editingItem?.id)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm text-black dark:text-white">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Sort Order</span>
                        <input
                          type="number"
                          name="sortOrder"
                          defaultValue={editingItem?.sortOrder ?? (selectedMenu.items.length + 1) * 10}
                          className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-black dark:text-white">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Target</span>
                      <input
                        name="target"
                        defaultValue={editingItem?.target || ""}
                        className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        placeholder="_blank"
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-black dark:text-white">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Rel</span>
                      <input
                        name="rel"
                        defaultValue={editingItem?.rel || ""}
                        className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        placeholder="noopener noreferrer"
                      />
                    </label>
                  </div>
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Meta (JSON)</span>
                    <textarea
                      name="meta"
                      defaultValue={editingItem?.meta ? JSON.stringify(editingItem.meta, null, 2) : ""}
                      rows={5}
                      className="rounded-md border border-stone-300 px-3 py-2 font-mono text-xs dark:border-stone-700 dark:bg-black"
                      placeholder='{"promo_style":"featured"}'
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-6">
                    <label className="inline-flex items-center gap-2 text-sm text-black dark:text-white">
                      <input
                        type="checkbox"
                        name="external"
                        defaultChecked={editingItem?.external || false}
                        className="h-4 w-4"
                      />
                      External Link
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-black dark:text-white">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={editingItem ? editingItem.enabled !== false : true}
                        className="h-4 w-4"
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-md border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-white hover:text-black">
                      {editingItem ? "Save Menu Item" : "Create Menu Item"}
                    </button>
                  </div>
                </form>

                {editingItem ? (
                  <form action={deleteItemAction} className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                    <input type="hidden" name="menu_id" value={selectedMenu.id} />
                    <input type="hidden" name="item_id" value={editingItem.id} />
                    <input type="hidden" name="confirm_expected" value={editingItem.title} />
                    <div className="text-sm font-semibold text-red-700 dark:text-red-300">Delete Menu Item</div>
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      Type <code>{editingItem.title}</code> to permanently remove this item.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <input
                        name="confirm_value"
                        className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-black"
                        placeholder={editingItem.title}
                      />
                      <button className="rounded-md border border-red-700 bg-red-700 px-3 py-2 text-sm font-semibold text-white">
                        Delete Item
                      </button>
                    </div>
                  </form>
                ) : null}
              </>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-stone-300 px-3 py-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                Select or create a menu before adding items.
              </div>
            )}
          </section>
          ) : null}
        </div>
      </div>
      ) : null}
    </div>
  );
}
