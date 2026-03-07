import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbMock,
  getSessionMock,
  canUserMutateDomainPostMock,
  userCanMock,
  siteDomainStore,
  settingsStoreMocks,
} = vi.hoisted(() => {
  const selectQueue: any[] = [];
  const insertQueue: any[] = [];
  const deleteQueue: any[] = [];
  const rowsBySite = new Map<string, Array<any>>();
  let nextDomainId = 1;

  const shiftInsertResult = () => {
    const value = insertQueue.shift() ?? [];
    if (value instanceof Error) throw value;
    return value;
  };

  const dbMock = {
    __pushSelectResult: (value: any) => selectQueue.push(value),
    __pushInsertResult: (value: any) => insertQueue.push(value),
    __pushDeleteResult: (value: any) => deleteQueue.push(value),
    select: vi.fn(() => {
      const value = selectQueue.shift() ?? [];
      const chain: any = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        groupBy: vi.fn(() => chain),
        orderBy: vi.fn(async () => value),
        limit: vi.fn(async () => value),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => shiftInsertResult()),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => shiftInsertResult()),
          then: undefined,
        })),
        returning: vi.fn(async () => shiftInsertResult()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => deleteQueue.shift() ?? []),
      })),
    })),
    query: {
      domainPosts: {
        findFirst: vi.fn(async () => ({ id: "post-1", userId: "user-1", siteId: "site-1", slug: "post-1" })),
      },
      sites: {
        findFirst: vi.fn(async () => ({ subdomain: "main", customDomain: null })),
      },
    },
    transaction: vi.fn(async (cb: any) =>
      cb({
        execute: vi.fn(async () => undefined),
        delete: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      }),
    ),
  };

  return {
    dbMock,
    getSessionMock: vi.fn(async () => ({ user: { id: "user-1" } })),
    canUserMutateDomainPostMock: vi.fn(async () => ({
      allowed: true,
      post: { id: "post-1", userId: "user-1", siteId: "site-1", slug: "post-1" },
    })),
    userCanMock: vi.fn(async () => true),
    siteDomainStore: {
      list: vi.fn(async (siteId: string) => rowsBySite.get(siteId) || []),
      upsert: vi.fn(async (siteId: string, payload: any) => {
        const list = rowsBySite.get(siteId) || [];
        const key = String(payload.key || "");
        const existingIndex = list.findIndex((row) => row.key === key);
        const record = existingIndex >= 0
          ? {
              ...list[existingIndex],
              ...payload,
            }
          : {
              id: nextDomainId++,
              ...payload,
            };
        if (existingIndex >= 0) list[existingIndex] = record;
        else list.push(record);
        rowsBySite.set(siteId, list);
        return { ...record, isActive: payload.isActive !== false };
      }),
      findById: vi.fn(async (siteId: string, domainId: number) => {
        const list = rowsBySite.get(siteId) || [];
        const row = list.find((entry) => Number(entry.id) === Number(domainId));
        return row ? { ...row, isActive: row.isActive !== false } : null;
      }),
      findByKey: vi.fn(async (siteId: string, key: string) => {
        const list = rowsBySite.get(siteId) || [];
        const row = list.find((entry) => String(entry.key) === String(key));
        return row ? { ...row, isActive: row.isActive !== false } : null;
      }),
      setActive: vi.fn(async (siteId: string, key: string, isActive: boolean) => {
        const list = rowsBySite.get(siteId) || [];
        const row = list.find((entry) => String(entry.key) === String(key));
        if (row) row.isActive = isActive;
      }),
      updateById: vi.fn(async (siteId: string, domainId: number, patch: any) => {
        const list = rowsBySite.get(siteId) || [];
        const index = list.findIndex((entry) => Number(entry.id) === Number(domainId));
        if (index < 0) return null;
        list[index] = { ...list[index], ...patch };
        return { ...list[index], isActive: list[index].isActive !== false };
      }),
      deleteById: vi.fn(async (siteId: string, domainId: number) => {
        const list = rowsBySite.get(siteId) || [];
        const index = list.findIndex((entry) => Number(entry.id) === Number(domainId));
        if (index < 0) return null;
        const [deleted] = list.splice(index, 1);
        rowsBySite.set(siteId, list);
        return deleted;
      }),
      __reset: () => {
        rowsBySite.clear();
        nextDomainId = 1;
      },
    },
    settingsStoreMocks: {
      getSettingByKey: vi.fn(async () => undefined),
      getSettingsByKeys: vi.fn(async () => []),
      listSettingsByLikePatterns: vi.fn(async () => []),
      setSettingByKey: vi.fn(async () => undefined),
    },
  };
});

vi.mock("@/lib/db", () => ({
  default: dbMock,
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  withSiteAuth: (handler: any) => handler,
  withPostAuth: (handler: any) => handler,
}));

vi.mock("@/lib/authorization", () => ({
  canUserMutateDomainPost: canUserMutateDomainPostMock,
  userCan: userCanMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  ensureSiteDataDomainTable: vi.fn(async () => undefined),
  listSiteDataDomains: siteDomainStore.list,
  upsertSiteDataDomain: siteDomainStore.upsert,
  findSiteDataDomainById: siteDomainStore.findById,
  findSiteDataDomainByKey: siteDomainStore.findByKey,
  setSiteDataDomainActivation: siteDomainStore.setActive,
  updateSiteDataDomainById: siteDomainStore.updateById,
  deleteSiteDataDomainById: siteDomainStore.deleteById,
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingByKey: settingsStoreMocks.getSettingByKey,
  getSettingsByKeys: settingsStoreMocks.getSettingsByKeys,
  listSettingsByLikePatterns: settingsStoreMocks.listSettingsByLikePatterns,
  setSettingByKey: settingsStoreMocks.setSettingByKey,
}));

import {
  createCategoryByName,
  createDataDomain,
  createTagByName,
  deleteDomainPost,
  getAllCategories,
  getAllTags,
  getTaxonomyOverview,
  getTaxonomyTermMeta,
  setTaxonomyTermMeta,
} from "@/lib/actions";

describe("taxonomy actions", () => {
  beforeEach(() => {
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.delete.mockClear();
    dbMock.transaction.mockClear();
    dbMock.query.domainPosts.findFirst.mockClear();
    dbMock.query.sites.findFirst.mockClear();
    canUserMutateDomainPostMock.mockClear();
    userCanMock.mockClear();
    siteDomainStore.__reset();
    settingsStoreMocks.getSettingsByKeys.mockClear();
    settingsStoreMocks.getSettingByKey.mockClear();
    settingsStoreMocks.listSettingsByLikePatterns.mockClear();
    settingsStoreMocks.setSettingByKey.mockClear();
  });

  it("returns category taxonomy list", async () => {
    dbMock.__pushSelectResult([
      { id: 10, name: "News" },
      { id: 11, name: "Guides" },
    ]);

    const rows = await getAllCategories("site-1");
    expect(rows).toEqual([
      { id: 10, name: "News" },
      { id: 11, name: "Guides" },
    ]);
  });

  it("creates a tag taxonomy when value is new", async () => {
    dbMock.__pushSelectResult([]);
    dbMock.__pushInsertResult([{ id: 42, name: "tooty", slug: "tooty" }]);
    dbMock.__pushInsertResult([{ id: 99, termId: 42, taxonomy: "tag" }]);

    const created = await createTagByName("site-1", "Tooty");

    expect(created).toEqual({ id: 99, name: "tooty" });
    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it("uses existing category without creating duplicates", async () => {
    dbMock.__pushSelectResult([{ id: 7, name: "Docs" }]);

    const existing = await createCategoryByName("site-1", "Docs");

    expect(existing).toEqual({ id: 7, name: "Docs" });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("returns tag taxonomy list", async () => {
    dbMock.__pushSelectResult([{ id: 30, name: "alpha" }]);

    const rows = await getAllTags("site-1");
    expect(rows).toEqual([{ id: 30, name: "alpha" }]);
  });

  it("returns taxonomy term meta rows ordered by key", async () => {
    dbMock.__pushSelectResult([{ id: "site-1" }]);
    dbMock.__pushSelectResult([
      { key: "color", value: "blue" },
      { key: "icon", value: "star" },
    ]);

    const rows = await getTaxonomyTermMeta(9);

    expect(rows).toEqual([
      { key: "color", value: "blue" },
      { key: "icon", value: "star" },
    ]);
  });

  it("reuses the general term when default category creation races under shared load", async () => {
    dbMock.__pushSelectResult([]);
    dbMock.__pushSelectResult([]);
    dbMock.__pushInsertResult(Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }));
    dbMock.__pushSelectResult([{ id: 11 }]);
    dbMock.__pushSelectResult([]);

    const rows = await getTaxonomyOverview("site-1");

    expect(rows).toEqual([{ taxonomy: "category", termCount: 0, usageCount: 0, label: "Category" }]);
    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it("upserts taxonomy term meta with normalized key", async () => {
    const result = await setTaxonomyTermMeta({
      siteId: "site-1",
      termTaxonomyId: 9,
      key: " SEO Title ",
      value: "Hello",
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  it("creates data domains using site-scoped domain-type table templates", async () => {
    const previous = process.env.CMS_DB_PREFIX;
    process.env.CMS_DB_PREFIX = "tooty_";

    const created = await createDataDomain({ label: "used cars", siteId: "site-1" });

    expect(siteDomainStore.upsert).toHaveBeenCalledTimes(3);
    expect(created).toMatchObject({
      key: "used-car",
      contentTable: "tooty_site_{id}_domain_used_car",
      metaTable: "tooty_site_{id}_domain_used_car_meta",
    });

    process.env.CMS_DB_PREFIX = previous;
  });

  it("blocks post delete when confirmation keyword is missing", async () => {
    const formData = new FormData();
    formData.set("confirm", "nope");

    const result = await deleteDomainPost(formData, "post-1");

    expect(result).toEqual({ error: "Type delete to confirm post deletion." });
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("deletes post when confirmation keyword is valid", async () => {
    const formData = new FormData();
    formData.set("confirm", "Delete");

    const result = await deleteDomainPost(formData, "post-1");

    expect(result).toEqual({ siteId: "site-1" });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });

  it("accepts lowercase delete keyword", async () => {
    const formData = new FormData();
    formData.set("confirm", "delete");

    const result = await deleteDomainPost(formData, "post-1");

    expect(result).toEqual({ siteId: "site-1" });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });
});
