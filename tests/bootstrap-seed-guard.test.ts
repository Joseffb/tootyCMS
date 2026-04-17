import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sitesFindFirst = vi.fn();
  const dataDomainsFindFirst = vi.fn();
  const usersFindFirst = vi.fn();
  const insertValues = vi.fn();
  const insert = vi.fn();
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }));
  const del = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  const createSiteMenu = vi.fn(async () => ({ id: "menu-1" }));
  const createSiteMenuItem = vi.fn(async () => ({ id: "item-1" }));
  const createSiteDomainPost = vi.fn(async (payload: unknown) => payload);
  const listSiteDomainPosts = vi.fn(async () => []);
  const updateSiteDomainPostById = vi.fn(async () => null);
  const deleteSiteDomainPostById = vi.fn(async () => undefined);

  return {
    listSiteIdsForUser: vi.fn(async () => []),
    upsertSiteUserRole: vi.fn(async () => undefined),
    ensureDefaultCoreDataDomains: vi.fn(async () => new Map([["post", 1], ["page", 2]])),
    getCoreDomainByKeyForSite: vi.fn(async (_siteId: string, key: "post" | "page") => ({
      id: key === "post" ? 1 : 2,
      key,
    })),
    isRandomDefaultImagesEnabled: vi.fn(async () => false),
    sitesFindFirst,
    dataDomainsFindFirst,
    usersFindFirst,
    insert,
    insertValues,
    update,
    del,
    createSiteMenu,
    createSiteMenuItem,
    createSiteDomainPost,
    listSiteDomainPosts,
    updateSiteDomainPostById,
    deleteSiteDomainPostById,
    seededRows: [] as unknown[],
  };
});

vi.mock("@/lib/site-user-tables", () => ({
  listSiteIdsForUser: mocks.listSiteIdsForUser,
  upsertSiteUserRole: mocks.upsertSiteUserRole,
}));

vi.mock("@/lib/default-data-domains", () => ({
  DEFAULT_CORE_DOMAIN_KEYS: ["post", "page"],
  ensureDefaultCoreDataDomains: mocks.ensureDefaultCoreDataDomains,
  getCoreDomainByKeyForSite: mocks.getCoreDomainByKeyForSite,
}));

vi.mock("@/lib/cms-config", () => ({
  isRandomDefaultImagesEnabled: mocks.isRandomDefaultImagesEnabled,
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: { findFirst: mocks.sitesFindFirst },
      dataDomains: { findFirst: mocks.dataDomainsFindFirst },
      users: { findFirst: mocks.usersFindFirst },
    },
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.del,
  },
}));

vi.mock("@/lib/menu-system", () => ({
  createSiteMenu: mocks.createSiteMenu,
  createSiteMenuItem: mocks.createSiteMenuItem,
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  createSiteDomainPost: mocks.createSiteDomainPost,
  listSiteDomainPosts: mocks.listSiteDomainPosts,
  updateSiteDomainPostById: mocks.updateSiteDomainPostById,
  deleteSiteDomainPostById: mocks.deleteSiteDomainPostById,
}));

function buildInsertChain() {
  return {
    values: (payload: any) => {
      mocks.insertValues(payload);
      const rows = Array.isArray(payload) ? payload : [payload];
      const hasWelcomeSlug = rows.some((row) => String(row?.slug || "") === "welcome-to-tooty");
      if (hasWelcomeSlug) {
        mocks.seededRows.push(...rows);
      }
      return {
        onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "site-1" }]) })),
        onConflictDoUpdate: vi.fn(async () => undefined),
        returning: vi.fn(async () => [{ id: "site-1" }]),
      };
    },
  };
}

describe("bootstrap seed guard", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.sitesFindFirst.mockReset();
    mocks.dataDomainsFindFirst.mockReset();
    mocks.insert.mockReset();
    mocks.insertValues.mockReset();
    mocks.upsertSiteUserRole.mockReset();
    mocks.listSiteIdsForUser.mockReset();
    mocks.ensureDefaultCoreDataDomains.mockReset();
    mocks.isRandomDefaultImagesEnabled.mockReset();
    mocks.getCoreDomainByKeyForSite.mockReset();
    mocks.usersFindFirst.mockReset();
    mocks.update.mockClear();
    mocks.del.mockClear();
    mocks.createSiteMenu.mockClear();
    mocks.createSiteMenuItem.mockClear();
    mocks.createSiteDomainPost.mockReset();
    mocks.listSiteDomainPosts.mockReset();
    mocks.updateSiteDomainPostById.mockReset();
    mocks.deleteSiteDomainPostById.mockReset();
    mocks.seededRows.length = 0;

    // getGlobalMainSite() before and after initial insert
    mocks.sitesFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.listSiteIdsForUser.mockResolvedValue([]);
    mocks.ensureDefaultCoreDataDomains.mockResolvedValue(new Map([["post", 1], ["page", 2]]));
    mocks.getCoreDomainByKeyForSite.mockImplementation(async (_siteId: string, key: "post" | "page") => ({
      id: key === "post" ? 1 : 2,
      key,
    }));
    mocks.isRandomDefaultImagesEnabled.mockResolvedValue(false);
    mocks.usersFindFirst.mockResolvedValue({ role: "administrator" });
    mocks.listSiteDomainPosts.mockResolvedValue([]);
    mocks.createSiteDomainPost.mockImplementation(async (payload: unknown) => {
      mocks.seededRows.push(payload);
      return payload;
    });

    // post/page lookups used only when seedStarterContent=true
    mocks.dataDomainsFindFirst
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 1 });

    mocks.insert.mockImplementation(() => buildInsertChain());
  });

  it("does not seed starter posts when seedStarterContent is false", { timeout: 45_000 }, async () => {
    const { ensureMainSiteForUser } = await import("@/lib/bootstrap");

    await ensureMainSiteForUser("user-1", { seedStarterContent: false });

    expect(mocks.seededRows.length).toBe(0);
    expect(mocks.createSiteMenu).toHaveBeenCalledWith(
      "site-1",
      expect.objectContaining({
        key: "homepage",
        title: "Homepage",
        location: "header",
      }),
    );
    expect(mocks.createSiteMenuItem).toHaveBeenCalledTimes(2);
  });

  it("seeds starter posts when seedStarterContent is true", { timeout: 45_000 }, async () => {
    const { ensureMainSiteForUser } = await import("@/lib/bootstrap");

    await ensureMainSiteForUser("user-1", { seedStarterContent: true });

    expect(mocks.seededRows.some((row: any) => row.slug === "welcome-to-tooty")).toBe(true);
    expect(mocks.seededRows.some((row: any) => row.slug === "about-this-site")).toBe(true);
    expect(mocks.seededRows.some((row: any) => row.slug === "terms-of-service")).toBe(true);
    expect(mocks.seededRows.some((row: any) => row.slug === "privacy-policy")).toBe(true);
  });

  it("returns early and does not create or upsert when user no longer exists", { timeout: 45_000 }, async () => {
    mocks.usersFindFirst.mockResolvedValue(null);
    const { ensureMainSiteForUser } = await import("@/lib/bootstrap");

    await ensureMainSiteForUser("missing-user", { seedStarterContent: true });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.upsertSiteUserRole).not.toHaveBeenCalled();
    expect(mocks.seededRows.length).toBe(0);
  });
});
