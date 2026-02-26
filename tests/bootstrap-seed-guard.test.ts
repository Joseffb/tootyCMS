import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sitesFindFirst = vi.fn();
  const dataDomainsFindFirst = vi.fn();
  const insertValues = vi.fn();
  const insert = vi.fn();
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }));
  const del = vi.fn(() => ({ where: vi.fn(async () => undefined) }));

  return {
    listSiteIdsForUser: vi.fn(async () => []),
    upsertSiteUserRole: vi.fn(async () => undefined),
    ensureDefaultCoreDataDomains: vi.fn(async () => new Map([["post", 1], ["page", 2]])),
    isRandomDefaultImagesEnabled: vi.fn(async () => false),
    sitesFindFirst,
    dataDomainsFindFirst,
    insert,
    insertValues,
    update,
    del,
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
}));

vi.mock("@/lib/cms-config", () => ({
  isRandomDefaultImagesEnabled: mocks.isRandomDefaultImagesEnabled,
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: { findFirst: mocks.sitesFindFirst },
      dataDomains: { findFirst: mocks.dataDomainsFindFirst },
      users: { findFirst: vi.fn(async () => ({ role: "administrator" })) },
    },
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.del,
  },
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
    mocks.update.mockClear();
    mocks.del.mockClear();
    mocks.seededRows.length = 0;

    // getGlobalMainSite() before and after initial insert
    mocks.sitesFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    // post/page lookups used only when seedStarterContent=true
    mocks.dataDomainsFindFirst
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 1 });

    mocks.insert.mockImplementation(() => buildInsertChain());
  });

  it("does not seed starter posts when seedStarterContent is false", async () => {
    const { ensureMainSiteForUser } = await import("@/lib/bootstrap");

    await ensureMainSiteForUser("user-1", { seedStarterContent: false });

    expect(mocks.seededRows.length).toBe(0);
  });

  it("seeds starter posts when seedStarterContent is true", async () => {
    const { ensureMainSiteForUser } = await import("@/lib/bootstrap");

    await ensureMainSiteForUser("user-1", { seedStarterContent: true });

    expect(mocks.seededRows.some((row: any) => row.slug === "welcome-to-tooty")).toBe(true);
    expect(mocks.seededRows.some((row: any) => row.slug === "about-this-site")).toBe(true);
    expect(mocks.seededRows.some((row: any) => row.slug === "terms-of-service")).toBe(true);
    expect(mocks.seededRows.some((row: any) => row.slug === "privacy-policy")).toBe(true);
  });
});
