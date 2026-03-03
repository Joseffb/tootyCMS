// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteMenuSettingsPage from "@/app/app/(dashboard)/site/[id]/settings/menus/page";

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

vi.mock("@/components/media/media-picker-field", () => ({
  default: ({ label }: { label: string }) => <div data-testid="menu-media-field">{label}</div>,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("SiteMenuSettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the native menu manager UI with menu and item editors", async () => {
    const ui = await SiteMenuSettingsPage({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByText("Site Menus")).toBeTruthy();
    expect(screen.getByText("Primary Menu")).toBeTruthy();
    expect(screen.getByText("Menu Items")).toBeTruthy();
    expect(screen.getByText("Edit Menu Item")).toBeTruthy();
    expect(screen.getByTestId("menu-media-field")).toBeTruthy();
  });
});
