import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  findSite: vi.fn(),
  transaction: vi.fn(),
  listSiteDataDomains: vi.fn(),
  findSiteDataDomainById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.execute,
    query: {
      sites: {
        findFirst: mocks.findSite,
      },
    },
    transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  listSiteDataDomains: mocks.listSiteDataDomains,
  findSiteDataDomainById: mocks.findSiteDataDomainById,
}));

import {
  ensureSiteDomainTypeTables,
  resetSiteDomainTypeTablesCache,
  siteDomainTypeMetaTableName,
  siteDomainTypeTableName,
} from "@/lib/site-domain-type-tables";

describe("ensureSiteDomainTypeTables", () => {
  beforeEach(() => {
    resetSiteDomainTypeTablesCache();
    mocks.execute.mockReset();
    mocks.findSite.mockReset();
    mocks.transaction.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.findSiteDataDomainById.mockReset();
    mocks.findSite.mockResolvedValue({ id: "site-1" });
  });

  it("does not expose the resolved table cache before the DDL transaction commits", async () => {
    let releaseCommit: (() => void) | null = null;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    mocks.transaction.mockImplementation(async (callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) => {
      const result = await callback({ execute: mocks.execute });
      await commitGate;
      return result;
    });

    const first = ensureSiteDomainTypeTables("site-1", "post");
    await Promise.resolve();

    const second = ensureSiteDomainTypeTables("site-1", "post");
    let secondResolved = false;
    void second.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(secondResolved).toBe(false);

    releaseCommit?.();

    const expected = {
      contentTable: siteDomainTypeTableName("site-1", "post"),
      metaTable: siteDomainTypeMetaTableName("site-1", "post"),
    };

    await expect(first).resolves.toEqual(expected);
    await expect(second).resolves.toEqual(expected);
  });

  it("waits for concurrently created relations to become visible before proceeding", async () => {
    mocks.transaction.mockImplementation(async (callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
      callback({ execute: mocks.execute }),
    );

    const duplicateTypeError = () =>
      Object.assign(new Error("duplicate type"), {
        code: "23505",
        constraint: "pg_type_typname_nsp_index",
      });
    let contentCreateFailed = false;
    let metaCreateFailed = false;
    mocks.execute.mockImplementation(async (statement: any) => {
      const chunks = Array.isArray(statement?.queryChunks) ? statement.queryChunks : [];
      const text = chunks
        .map((chunk: any) => {
          if (typeof chunk === "string") return chunk;
          if (Array.isArray(chunk?.value)) return chunk.value.join("");
          return "";
        })
        .join("");

      if (text.includes("SELECT to_regclass(") && text.includes(siteDomainTypeTableName("site-1", "post"))) {
        return { rows: [{ relation_name: siteDomainTypeTableName("site-1", "post") }] };
      }

      if (text.includes("SELECT to_regclass(") && text.includes(siteDomainTypeMetaTableName("site-1", "post"))) {
        return { rows: [{ relation_name: siteDomainTypeMetaTableName("site-1", "post") }] };
      }

      if (text.includes(`CREATE TABLE IF NOT EXISTS \"${siteDomainTypeTableName("site-1", "post")}\"`) && !contentCreateFailed) {
        contentCreateFailed = true;
        throw duplicateTypeError();
      }

      if (text.includes(`CREATE TABLE IF NOT EXISTS \"${siteDomainTypeMetaTableName("site-1", "post")}\"`) && !metaCreateFailed) {
        metaCreateFailed = true;
        throw duplicateTypeError();
      }

      return { rows: [] };
    });

    await expect(ensureSiteDomainTypeTables("site-1", "post")).resolves.toEqual({
      contentTable: siteDomainTypeTableName("site-1", "post"),
      metaTable: siteDomainTypeMetaTableName("site-1", "post"),
    });
  });
});
