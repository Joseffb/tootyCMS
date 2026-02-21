import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, getSessionMock } = vi.hoisted(() => {
  const selectQueue: any[] = [];
  const insertQueue: any[] = [];

  const dbMock = {
    __pushSelectResult: (value: any) => selectQueue.push(value),
    __pushInsertResult: (value: any) => insertQueue.push(value),
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
        returning: vi.fn(async () => insertQueue.shift() ?? []),
      })),
    })),
    transaction: vi.fn(async (cb: any) =>
      cb({
        execute: vi.fn(async () => undefined),
      }),
    ),
  };

  return {
    dbMock,
    getSessionMock: vi.fn(async () => ({ user: { id: "user-1" } })),
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
  getAllCategories,
  getAllTags,
} from "@/lib/actions";

describe("taxonomy actions", () => {
  beforeEach(() => {
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.transaction.mockClear();
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
});
