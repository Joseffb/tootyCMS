// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteMenuSettingsPage from "@/app/app/(dashboard)/site/[id]/settings/menus/page";
import { getSiteMenuDefinition, listSiteMenus } from "@/lib/menu-system";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

vi.mock("@/lib/authorization", () => ({
  getAuthorizedSiteForUser: vi.fn(async () => ({ id: "site-1", name: "Test Site" })),
  userCan: vi.fn(async () => true),
}));

vi.mock("@/lib/menu-system", () => ({
  createSiteMenu: vi.fn(),
  createSiteMenuItem: vi.fn(),
  deleteSiteMenu: vi.fn(),
  deleteSiteMenuItem: vi.fn(),
  getSiteMenu: vi.fn(async () => [{ label: "Main Site", href: "/" }]),
  getSiteMenuDefinition: vi.fn(async () => null),
  listSiteMenus: vi.fn(async () => [
    {
      id: "menu-1",
      siteId: "site-1",
      key: "primary",
      title: "Primary Menu",
      description: "Main navigation",
      location: "header",
      sortOrder: 10,
      items: [
        {
          id: "item-1",
          menuId: "menu-1",
          parentId: null,
          title: "Worlds",
          href: "/",
          description: "Return to the main hub",
          mediaId: "",
          image: "",
          target: "",
          rel: "",
          external: false,
          enabled: true,
          sortOrder: 10,
          meta: {},
        },
      ],
    },
  ]),
  parseMenuMetaJson: vi.fn(() => ({})),
  updateSiteMenu: vi.fn(),
  updateSiteMenuItem: vi.fn(),
}));

vi.mock("@/lib/site-menu-tables", () => ({
  ensureSiteMenuTables: vi.fn(async () => undefined),
  siteMenuTablesReady: vi.fn(async () => true),
}));

vi.mock("@/lib/site-media-tables", () => ({
  ensureSiteMediaTable: vi.fn(async () => undefined),
  siteMediaTableReady: vi.fn(async () => true),
}));

vi.mock("@/components/media/media-picker-field", () => ({
  default: ({ label }: { label: string }) => <div data-testid="menu-media-field">{label}</div>,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  unstable_noStore: vi.fn(),
}));

describe("SiteMenuSettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the native menu manager UI with list-first controls", async () => {
    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByText("Site Menus")).toBeTruthy();
    expect(screen.getByText("Primary Menu")).toBeTruthy();
    expect(screen.getByText("Add Menu")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit menu Primary Menu" })).toBeTruthy();
    expect(screen.queryByText("primary")).toBeNull();
    expect(screen.queryByText("Menu Items")).toBeNull();
    expect(screen.queryByText("Add Item")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit menu item Worlds" })).toBeNull();
    expect(screen.queryByText("Edit Menu Item")).toBeNull();
  });

  it("renders the detail-first menu workspace when a menu is selected", async () => {
    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({ menu: "menu-1" }),
    });

    render(ui);

    expect(screen.getByRole("heading", { name: "Primary Menu" })).toBeTruthy();
    expect(screen.getByText("Main navigation")).toBeTruthy();
    expect(screen.getByText("Menu Items")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add Item" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Menus" })).toBeNull();
  });

  it("renders the edit-menu form inside the detail workspace", async () => {
    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({ menu: "menu-1", editMenu: "menu-1" }),
    });

    render(ui);

    expect(screen.getByRole("heading", { name: "Edit Menu" })).toBeTruthy();
    expect(screen.getByText("Key")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /key/i })).toHaveValue("primary");
    expect(screen.queryByRole("heading", { name: "Menus" })).toBeNull();
  });

  it("renders the item editor on demand when edit state is requested", async () => {
    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({ menu: "menu-1", item: "item-1", editItem: "item-1" }),
    });

    render(ui);

    expect(screen.getByText("Edit Menu Item")).toBeTruthy();
    expect(screen.getByTestId("menu-media-field")).toBeTruthy();
  });

  it("shows a list-first empty state when the site has no menus", async () => {
    vi.mocked(listSiteMenus).mockResolvedValueOnce([]);

    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByRole("link", { name: "Add Menu" })).toBeTruthy();
    expect(screen.getByText("No native menus yet.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Start with a Native Menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import Current Header Menu" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Create Menu" })).toBeNull();
  });

  it("opens the create-menu editor on demand in an empty state", async () => {
    vi.mocked(listSiteMenus).mockResolvedValueOnce([]);

    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({ createMenu: "1" }),
    });

    render(ui);

    expect(screen.getByRole("heading", { name: "Create Menu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Menu" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Start with a Native Menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import Current Header Menu" })).toBeNull();
  });

  it("keeps the site-native menu workspace available without consulting legacy shared-table health state", async () => {
    vi.mocked(listSiteMenus).mockResolvedValueOnce([]);

    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByRole("heading", { name: "Site Menus" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add Menu" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Native Menus Need a Database Update" })).toBeNull();
  });

  it("injects the selected menu into the list when pooled reads omit it from the initial menu listing", async () => {
    vi.mocked(listSiteMenus).mockResolvedValueOnce([]);
    vi.mocked(getSiteMenuDefinition).mockResolvedValueOnce({
      id: "menu-stale",
      siteId: "site-1",
      key: "footer-stale",
      title: "Footer Menu Stale Read",
      description: "Recovered from direct menu read",
      location: "footer",
      sortOrder: 10,
      items: [],
    } as any);

    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({ menu: "menu-stale" }),
    });

    render(ui);

    expect(screen.getByText("Footer Menu Stale Read")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit Menu" })).toBeTruthy();
  });

  it("shows a syncing detail state for a newly created menu while pooled reads catch up", async () => {
    vi.mocked(listSiteMenus).mockResolvedValueOnce([]);
    vi.mocked(getSiteMenuDefinition).mockResolvedValue(null);

    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({
        menu: "menu-pending",
        pendingMenuTitle: "Lifecycle Footer Menu chromium",
        pendingMenuKey: "lifecycle-footer-menu-chromium",
        pendingMenuLocation: "footer",
      }),
    });

    render(ui);

    expect(screen.getByRole("heading", { name: "Lifecycle Footer Menu chromium" })).toBeTruthy();
    expect(screen.getByText("Syncing the newly saved menu. Details will appear as soon as the database read catches up.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Selected Menu Not Available" })).toBeNull();
  });
});
