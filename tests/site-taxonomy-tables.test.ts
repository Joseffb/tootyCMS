import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  siteFindFirst: vi.fn(),
  execute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
}));

function queryText(statement: unknown) {
  if (!statement || typeof statement !== "object") return "";
  const chunks = (statement as { queryChunks?: Array<{ value?: string[] }> }).queryChunks;
  if (!Array.isArray(chunks)) return "";
  return chunks
    .flatMap((chunk) => (Array.isArray(chunk?.value) ? chunk.value : []))
    .join("");
}

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
    mocks.execute.mockImplementation(async (statement: unknown) => {
      const text = queryText(statement);
      if (text.includes("SELECT") && text.includes("pg_constraint")) {
        return { rows: [] };
      }
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

  it("drops stale taxonomy foreign keys that still point at old physical tables before recreating canonical constraints", async () => {
    let dbExecuteCalls = 0;
    mocks.execute.mockImplementation(async (statement: unknown) => {
      const text = queryText(statement);
      if (text.includes("SELECT") && text.includes("pg_constraint")) {
        return {
          rows: [
            {
              constraint_name: "legacy_term_fk",
              referenced_table: "tooty_site_site_1_terms_legacy",
              columns: ["termId"],
            },
          ],
        };
      }
      dbExecuteCalls += 1;
      const relationName =
        dbExecuteCalls <= 8 ? "present" : dbExecuteCalls <= 16 ? null : "present";
      return { rows: [{ relation_name: relationName }] };
    });

    const { ensureSiteTaxonomyTables } = await import("@/lib/site-taxonomy-tables");
    await ensureSiteTaxonomyTables("site-1");

    const executedSql = [
      ...mocks.txExecute.mock.calls.map(([statement]) => queryText(statement)),
      ...mocks.execute.mock.calls.map(([statement]) => queryText(statement)),
    ];

    expect(
      executedSql.some((text) =>
        text.includes('ALTER TABLE "tooty_site_site_1_term_taxonomies" DROP CONSTRAINT IF EXISTS "legacy_term_fk"'),
      ),
    ).toBe(true);
    expect(
      executedSql.some((text) =>
        text.includes('ALTER TABLE "tooty_site_site_1_term_taxonomies"') &&
        text.includes('ADD CONSTRAINT "tooty_site_site_1_term_taxonomies_term_fk"'),
      ),
    ).toBe(true);
  });

  it("repairs stale taxonomy foreign keys even when the site was already cached and relations still exist", async () => {
    let constraintChecks = 0;
    let relationChecks = 0;
    mocks.execute.mockImplementation(async (statement: unknown) => {
      const text = queryText(statement);
      if (text.includes("SELECT") && text.includes("pg_constraint")) {
        constraintChecks += 1;
        return {
          rows: [
            {
              constraint_name: "legacy_term_fk",
              referenced_table: "tooty_site_other_site_terms",
              columns: ["termId"],
            },
          ],
        };
      }
      relationChecks += 1;
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteTaxonomyTables } = await import("@/lib/site-taxonomy-tables");
    await ensureSiteTaxonomyTables("site-1");
    mocks.transaction.mockClear();

    await ensureSiteTaxonomyTables("site-1");

    const executedSql = mocks.execute.mock.calls.map(([statement]) => queryText(statement));

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(constraintChecks).toBeGreaterThanOrEqual(2);
    expect(relationChecks).toBeGreaterThan(0);
    expect(
      executedSql.some((text) =>
        text.includes('ALTER TABLE "tooty_site_site_1_term_taxonomies" DROP CONSTRAINT IF EXISTS "legacy_term_fk"'),
      ),
    ).toBe(true);
    expect(
      executedSql.some((text) =>
        text.includes('ALTER TABLE "tooty_site_site_1_term_taxonomies"') &&
        text.includes('ADD CONSTRAINT "tooty_site_site_1_term_taxonomies_term_fk"'),
      ),
    ).toBe(true);
  });
});
