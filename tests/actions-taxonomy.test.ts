import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, getSessionMock, canUserMutateDomainPostMock, userCanMock } = vi.hoisted(() => {
  const selectQueue: any[] = [];
  const insertQueue: any[] = [];
  const deleteQueue: any[] = [];

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
        orderBy: vi.fn(async () => value),
        limit: vi.fn(async () => value),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => insertQueue.shift() ?? []),
        returning: vi.fn(async () => insertQueue.shift() ?? []),
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

import {
  createCategoryByName,
  createDataDomain,
  createTagByName,
  deleteDomainPost,
  getAllCategories,
  getAllTags,
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
  });

  it("returns category taxonomy list", async () => {
    dbMock.__pushSelectResult([
      { id: 10, name: "News" },
      { id: 11, name: "Guides" },
    ]);

    const rows = await getAllCategories();
    expect(rows).toEqual([
      { id: 10, name: "News" },
      { id: 11, name: "Guides" },
    ]);
  });

  it("creates a tag taxonomy when value is new", async () => {
    dbMock.__pushSelectResult([]);
    dbMock.__pushInsertResult([{ id: 42, name: "tooty", slug: "tooty" }]);
    dbMock.__pushInsertResult([{ id: 99, termId: 42, taxonomy: "tag" }]);

    const created = await createTagByName("Tooty");

    expect(created).toEqual({ id: 99, name: "tooty" });
    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it("uses existing category without creating duplicates", async () => {
    dbMock.__pushSelectResult([{ id: 7, name: "Docs" }]);

    const existing = await createCategoryByName("Docs");

    expect(existing).toEqual({ id: 7, name: "Docs" });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("returns tag taxonomy list", async () => {
    dbMock.__pushSelectResult([{ id: 30, name: "alpha" }]);

    const rows = await getAllTags();
    expect(rows).toEqual([{ id: 30, name: "alpha" }]);
  });

  it("returns taxonomy term meta rows ordered by key", async () => {
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

  it("upserts taxonomy term meta with normalized key", async () => {
    const result = await setTaxonomyTermMeta({
      termTaxonomyId: 9,
      key: " SEO Title ",
      value: "Hello",
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  it("creates per-domain content and meta table names with dynamic prefix", async () => {
    const previous = process.env.CMS_DB_PREFIX;
    process.env.CMS_DB_PREFIX = "tooty_";

    dbMock.__pushSelectResult([]);
    dbMock.__pushSelectResult([]);
    dbMock.__pushInsertResult([
      {
        id: 1,
        key: "used-cars",
        label: "used cars",
        contentTable: "tooty_domain_used-cars",
        metaTable: "tooty_domain_used-cars_meta",
      },
    ]);

    const created = await createDataDomain({ label: "used cars" });

    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(created).toMatchObject({
      key: "used-cars",
      contentTable: "tooty_domain_used-cars",
      metaTable: "tooty_domain_used-cars_meta",
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
