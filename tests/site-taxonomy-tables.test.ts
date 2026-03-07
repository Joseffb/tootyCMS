import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  siteFindFirst: vi.fn(),
  execute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: {
        findFirst: mocks.siteFindFirst,
      },
    },
    execute: mocks.execute,
    transaction: mocks.transaction,
  },
}));

describe("site taxonomy tables", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.siteFindFirst.mockReset();
    mocks.execute.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockReset();

    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    let dbExecuteCalls = 0;
    mocks.execute.mockImplementation(async () => {
      dbExecuteCalls += 1;
      const relationName =
        dbExecuteCalls <= 8 ? "present" : dbExecuteCalls <= 16 ? null : "present";
      return { rows: [{ relation_name: relationName }] };
    });
    mocks.txExecute.mockResolvedValue({ rows: [{ relation_name: "present" }] });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        query: {
          sites: {
            findFirst: mocks.siteFindFirst,
          },
        },
        execute: mocks.txExecute,
      };
      return callback(tx);
    });
  });

  it("rebuilds cached site taxonomy tables when physical relations are missing", async () => {
    const { ensureSiteTaxonomyTables } = await import("@/lib/site-taxonomy-tables");

    const first = await ensureSiteTaxonomyTables("site-1");
    const second = await ensureSiteTaxonomyTables("site-1");

    expect(first.termsTable[Symbol.for("drizzle:Name")]).toBe(second.termsTable[Symbol.for("drizzle:Name")]);
    expect(first.termTaxonomiesTable[Symbol.for("drizzle:Name")]).toBe(
      second.termTaxonomiesTable[Symbol.for("drizzle:Name")],
    );
    expect(first.termRelationshipsTable[Symbol.for("drizzle:Name")]).toBe(
      second.termRelationshipsTable[Symbol.for("drizzle:Name")],
    );
    expect(first.termTaxonomyDomainsTable[Symbol.for("drizzle:Name")]).toBe(
      second.termTaxonomyDomainsTable[Symbol.for("drizzle:Name")],
    );
    expect(first.termTaxonomyMetaTable[Symbol.for("drizzle:Name")]).toBe(
      second.termTaxonomyMetaTable[Symbol.for("drizzle:Name")],
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("retries taxonomy reads after a missing relation error", async () => {
    const { withSiteTaxonomyTableRecovery } = await import("@/lib/site-taxonomy-tables");
    const missingRelationError = Object.assign(
      new Error('relation "tooty_site_site_1_terms" does not exist'),
      { code: "42P01" },
    );
    const run = vi.fn().mockRejectedValueOnce(missingRelationError).mockResolvedValueOnce("ok");

    await expect(withSiteTaxonomyTableRecovery("site-1", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("retries taxonomy reads when term taxonomy domain relations are missing", async () => {
    const { withSiteTaxonomyTableRecovery } = await import("@/lib/site-taxonomy-tables");
    const missingRelationError = Object.assign(
      new Error('relation "tooty_site_site_1_term_taxonomy_domains" does not exist'),
      { code: "42P01" },
    );
    const run = vi.fn().mockRejectedValueOnce(missingRelationError).mockResolvedValueOnce("ok");

    await expect(withSiteTaxonomyTableRecovery("site-1", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("retries taxonomy reads when term taxonomy meta relations are missing", async () => {
    const { withSiteTaxonomyTableRecovery } = await import("@/lib/site-taxonomy-tables");
    const missingRelationError = Object.assign(
      new Error('relation "tooty_site_site_1_term_taxonomy_meta" does not exist'),
      { code: "42P01" },
    );
    const run = vi.fn().mockRejectedValueOnce(missingRelationError).mockResolvedValueOnce("ok");

    await expect(withSiteTaxonomyTableRecovery("site-1", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("retries taxonomy ensure when the initial ensure step surfaces a missing relation", async () => {
    const { withSiteTaxonomyTableRecovery } = await import("@/lib/site-taxonomy-tables");
    const missingRelationError = Object.assign(
      new Error('relation "tooty_site_site_1_term_relationships" does not exist'),
      { code: "42P01" },
    );
    let ensureCalls = 0;
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      ensureCalls += 1;
      if (ensureCalls === 1) {
        throw missingRelationError;
      }
      const tx = {
        query: {
          sites: {
            findFirst: mocks.siteFindFirst,
          },
        },
        execute: mocks.txExecute,
      };
      return callback(tx);
    });

    const run = vi.fn().mockResolvedValue("ok");

    await expect(withSiteTaxonomyTableRecovery("site-1", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
