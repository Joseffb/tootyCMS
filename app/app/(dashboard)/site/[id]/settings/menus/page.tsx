import { getSession } from "@/lib/auth";
import {
  createSiteMenu,
  createSiteMenuItem,
  deleteSiteMenu,
  deleteSiteMenuItem,
  getSiteMenu,
  getSiteMenuDefinition,
  listSiteMenus,
  parseMenuMetaJson,
  updateSiteMenu,
  updateSiteMenuItem,
} from "@/lib/menu-system";
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
  }>;
};

const MENU_LOCATIONS = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "dashboard", label: "Dashboard" },
  { value: "unassigned", label: "Unassigned" },
] as const;

function stringParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function menuSettingsHref(siteId: string, menuId?: string, itemId?: string) {
  const url = new URL(`http://tooty.local/app/site/${siteId}/settings/menus`);
  if (menuId) url.searchParams.set("menu", menuId);
  if (itemId) url.searchParams.set("item", itemId);
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

export default async function SiteMenuSettingsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const id = decodeURIComponent((await params).id);
  const site = await getAuthorizedSiteForUser(session.user.id, id, "site.menus.manage");
  if (!site) notFound();
  const siteData = site;

  const query = searchParams ? await searchParams : {};
  const menus = await listSiteMenus(siteData.id);
  const selectedMenuId = stringParam(query.menu) || menus[0]?.id || "";
  const selectedMenu = selectedMenuId
    ? menus.find((menu) => menu.id === selectedMenuId) || (await getSiteMenuDefinition(siteData.id, selectedMenuId))
    : null;
  const selectedItemId = stringParam(query.item);
  const selectedItem =
    selectedMenu?.items.find((item) => item.id === selectedItemId) ||
    selectedMenu?.items[0] ||
    null;
  const headerFallback = menus.length === 0 ? await getSiteMenu(siteData.id, "header") : [];

  async function ensureAllowed() {
    "use server";
    const activeSession = await getSession();
    if (!activeSession?.user?.id) redirect("/login");
    const allowed = await userCan("site.menus.manage", activeSession.user.id, { siteId: siteData.id });
    if (!allowed) redirect("/app");
  }

  async function saveMenuAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    const menuId = String(formData.get("menu_id") || "").trim();
    const payload = {
      key: String(formData.get("key") || "").trim(),
      title: String(formData.get("title") || "").trim(),
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
    redirect(menuSettingsHref(siteData.id, record.id));
  }

  async function deleteMenuAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    const menuId = String(formData.get("menu_id") || "").trim();
    const expected = String(formData.get("confirm_expected") || "").trim();
    const received = String(formData.get("confirm_value") || "").trim();
    if (!menuId) redirect(menuSettingsHref(siteData.id));
    if (!expected || received !== expected) throw new Error("Delete confirmation did not match.");
    await deleteSiteMenu(siteData.id, menuId);
    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(siteData.id));
  }

  async function importHeaderMenuAction() {
    "use server";
    await ensureAllowed();
    const imported = await getSiteMenu(siteData.id, "header");
    const menu = await createSiteMenu(siteData.id, {
      key: "primary",
      title: "Primary Menu",
      description: "Imported from the current header navigation.",
      location: "header",
      sortOrder: 10,
    });
    for (const [index, item] of imported.entries()) {
      if (!item.label || !item.href) continue;
      await createSiteMenuItem(siteData.id, menu.id, {
        title: item.label,
        href: item.href,
        description: item.description || "",
        mediaId: item.mediaId ? String(item.mediaId) : "",
        sortOrder: item.order ?? (index + 1) * 10,
        target: item.target,
        rel: item.rel,
        external: item.external,
        enabled: item.enabled !== false,
        meta: item.meta || {},
      });
    }
    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(siteData.id, menu.id));
  }

  async function saveItemAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    const menuId = String(formData.get("menu_id") || "").trim();
    if (!menuId) redirect(menuSettingsHref(siteData.id));
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
    redirect(menuSettingsHref(siteData.id, menuId, record.id));
  }

  async function deleteItemAction(formData: FormData) {
    "use server";
    await ensureAllowed();
    const menuId = String(formData.get("menu_id") || "").trim();
    const itemId = String(formData.get("item_id") || "").trim();
    const expected = String(formData.get("confirm_expected") || "").trim();
    const received = String(formData.get("confirm_value") || "").trim();
    if (!menuId || !itemId) redirect(menuSettingsHref(siteData.id, menuId));
    if (!expected || received !== expected) throw new Error("Delete confirmation did not match.");
    await deleteSiteMenuItem(siteData.id, menuId, itemId);
    revalidateMenuPaths(siteData.id);
    redirect(menuSettingsHref(siteData.id, menuId));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-cal text-2xl text-black dark:text-white">Site Menus</h1>
        <p className="max-w-3xl text-sm text-stone-600 dark:text-stone-400">
          Built-in menus are native to Tooty. Each site can manage multiple menus, assign them to locations,
          and attach rich item data such as descriptions, images, and extension-friendly meta fields.
        </p>
      </div>

      {menus.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-5 dark:border-stone-700 dark:bg-black">
          <h2 className="font-cal text-xl text-black dark:text-white">Start with a Native Menu</h2>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            This site does not have any native menus yet. You can create one from scratch, or import the current
            header links into the first native menu.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={importHeaderMenuAction}>
              <button className="rounded-md border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-white hover:text-black">
                Import Current Header Menu
              </button>
            </form>
            <Link
              href={menuSettingsHref(siteData.id)}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
            >
              Use the Create Menu form below
            </Link>
          </div>
          {headerFallback.length > 0 ? (
            <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-900/20">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
                Current Header Links
              </div>
              <ul className="mt-2 grid gap-2 text-sm text-stone-700 dark:text-stone-300">
                {headerFallback.map((item) => (
                  <li key={`${item.label}-${item.href}`} className="flex items-center justify-between gap-3">
                    <span className="font-medium">{item.label}</span>
                    <span className="truncate text-xs text-stone-500 dark:text-stone-400">{item.href}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div className="grid gap-6">
          <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">Menus</h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Click a row to manage that menu’s items.
                </p>
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-400">{menus.length} total</div>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
              <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-700">
                <thead className="bg-stone-50 dark:bg-stone-900/30">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Menu</th>
                    <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Location</th>
                    <th className="px-3 py-2 text-right font-semibold text-stone-600 dark:text-stone-300">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                  {menus.map((menu) => {
                    const isActive = selectedMenu?.id === menu.id;
                    return (
                      <tr key={menu.id} className={isActive ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                        <td className="px-3 py-2">
                      <Link href={menuSettingsHref(siteData.id, menu.id)} className="block">
                            <div className="font-medium text-stone-900 dark:text-white">{menu.title}</div>
                            <div className="truncate text-xs text-stone-500 dark:text-stone-400">{menu.key}</div>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-stone-600 dark:text-stone-300">
                          {menu.location === "unassigned" ? "Unassigned" : menu.location}
                        </td>
                        <td className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">
                          <Link href={menuSettingsHref(siteData.id, menu.id)} className="block">
                            {menu.items.length}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {menus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-stone-500 dark:text-stone-400">
                        No native menus yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">
                  {selectedMenu ? "Edit Menu" : "Create Menu"}
                </h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Menus are location-aware sets. Themes consume them through the existing menu API.
                </p>
              </div>
              {selectedMenu ? (
                <Link
                  href={menuSettingsHref(siteData.id)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                >
                  New Menu
                </Link>
              ) : null}
            </div>
            <form action={saveMenuAction} className="mt-4 grid gap-4">
              <input type="hidden" name="menu_id" value={selectedMenu?.id || ""} />
              <label className="grid gap-2 text-sm text-black dark:text-white">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Title</span>
                <input
                  name="title"
                  defaultValue={selectedMenu?.title || ""}
                  className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm text-black dark:text-white">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Key</span>
                <input
                  name="key"
                  defaultValue={selectedMenu?.key || ""}
                  className="rounded-md border border-stone-300 px-3 py-2 font-mono text-xs dark:border-stone-700 dark:bg-black"
                  placeholder="primary"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm text-black dark:text-white">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Description</span>
                <textarea
                  name="description"
                  defaultValue={selectedMenu?.description || ""}
                  rows={3}
                  className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-black dark:text-white">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Location</span>
                  <select
                    name="location"
                    defaultValue={selectedMenu?.location || "unassigned"}
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
                    defaultValue={selectedMenu?.sortOrder ?? 10}
                    className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="rounded-md border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-white hover:text-black">
                  {selectedMenu ? "Save Menu" : "Create Menu"}
                </button>
              </div>
            </form>
            {selectedMenu ? (
              <form action={deleteMenuAction} className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                <input type="hidden" name="menu_id" value={selectedMenu.id} />
                <input type="hidden" name="confirm_expected" value={selectedMenu.key} />
                <div className="text-sm font-semibold text-red-700 dark:text-red-300">Delete Menu</div>
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  Type <code>{selectedMenu.key}</code> to permanently remove this menu and its items.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    name="confirm_value"
                    className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-black"
                    placeholder={selectedMenu.key}
                  />
                  <button className="rounded-md border border-red-700 bg-red-700 px-3 py-2 text-sm font-semibold text-white">
                    Delete Menu
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        </div>

        <div className="grid gap-6">
          <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">Menu Items</h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Rich menu items support descriptions, media, and extension-ready meta fields.
                </p>
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                {selectedMenu ? `${selectedMenu.items.length} items` : "Select a menu"}
              </div>
            </div>
            {selectedMenu ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-700">
                  <thead className="bg-stone-50 dark:bg-stone-900/30">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Item</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Parent</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-600 dark:text-stone-300">Link</th>
                      <th className="px-3 py-2 text-right font-semibold text-stone-600 dark:text-stone-300">Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                    {selectedMenu.items.map((item) => {
                      const isActive = selectedItem?.id === item.id;
                      const parent = item.parentId
                        ? selectedMenu.items.find((entry) => entry.id === item.parentId)?.title || "Unknown"
                        : "Root";
                      return (
                        <tr key={item.id} className={isActive ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                          <td className="px-3 py-2">
                          <Link href={menuSettingsHref(siteData.id, selectedMenu.id, item.id)} className="block">
                              <div className="font-medium text-stone-900 dark:text-white">{item.title}</div>
                              {item.description ? (
                                <div className="truncate text-xs text-stone-500 dark:text-stone-400">{item.description}</div>
                              ) : null}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{parent}</td>
                          <td className="px-3 py-2">
                            <Link href={menuSettingsHref(siteData.id, selectedMenu.id, item.id)} className="block truncate text-xs text-stone-500 dark:text-stone-400">
                              {item.href}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">{item.sortOrder}</td>
                        </tr>
                      );
                    })}
                    {selectedMenu.items.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-stone-500 dark:text-stone-400">
                          No items in this menu yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-stone-300 px-3 py-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                Select a menu to manage its items.
              </div>
            )}
          </section>

          <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-cal text-xl text-black dark:text-white">
                  {selectedItem ? "Edit Menu Item" : "Create Menu Item"}
                </h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Menu items are content-like records with image and expansion-ready metadata.
                </p>
              </div>
              {selectedItem && selectedMenu ? (
                <Link
                  href={menuSettingsHref(siteData.id, selectedMenu.id)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                >
                  New Item
                </Link>
              ) : null}
            </div>

            {selectedMenu ? (
              <>
                <form action={saveItemAction} className="mt-4 grid gap-4">
                  <input type="hidden" name="menu_id" value={selectedMenu.id} />
                  <input type="hidden" name="item_id" value={selectedItem?.id || ""} />
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Title</span>
                    <input
                      name="title"
                      defaultValue={selectedItem?.title || ""}
                      className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                      required
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Link</span>
                    <input
                      name="href"
                      defaultValue={selectedItem?.href || ""}
                      className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                      placeholder="/posts"
                      required
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Description</span>
                    <textarea
                      name="description"
                      defaultValue={selectedItem?.description || ""}
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
                      initialValue={selectedItem?.image || ""}
                      initialMediaId={selectedItem?.mediaId || ""}
                      initialUrl={selectedItem?.image || ""}
                      initialLabel={selectedItem?.title || ""}
                    />
                    <div className="grid gap-4">
                      <label className="grid gap-2 text-sm text-black dark:text-white">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Parent Item</span>
                        <select
                          name="parentId"
                          defaultValue={selectedItem?.parentId || ""}
                          className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        >
                          <option value="">Root Item</option>
                          {selectedMenu.items
                            .filter((item) => item.id !== selectedItem?.id)
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
                          defaultValue={selectedItem?.sortOrder ?? (selectedMenu.items.length + 1) * 10}
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
                        defaultValue={selectedItem?.target || ""}
                        className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        placeholder="_blank"
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-black dark:text-white">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Rel</span>
                      <input
                        name="rel"
                        defaultValue={selectedItem?.rel || ""}
                        className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black"
                        placeholder="noopener noreferrer"
                      />
                    </label>
                  </div>
                  <label className="grid gap-2 text-sm text-black dark:text-white">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">Meta (JSON)</span>
                    <textarea
                      name="meta"
                      defaultValue={selectedItem?.meta ? JSON.stringify(selectedItem.meta, null, 2) : ""}
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
                        defaultChecked={selectedItem?.external || false}
                        className="h-4 w-4"
                      />
                      External Link
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-black dark:text-white">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={selectedItem ? selectedItem.enabled !== false : true}
                        className="h-4 w-4"
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-md border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-white hover:text-black">
                      {selectedItem ? "Save Menu Item" : "Create Menu Item"}
                    </button>
                  </div>
                </form>

                {selectedItem ? (
                  <form action={deleteItemAction} className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                    <input type="hidden" name="menu_id" value={selectedMenu.id} />
                    <input type="hidden" name="item_id" value={selectedItem.id} />
                    <input type="hidden" name="confirm_expected" value={selectedItem.title} />
                    <div className="text-sm font-semibold text-red-700 dark:text-red-300">Delete Menu Item</div>
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      Type <code>{selectedItem.title}</code> to permanently remove this item.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <input
                        name="confirm_value"
                        className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-black"
                        placeholder={selectedItem.title}
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
        </div>
      </div>
    </div>
  );
}
