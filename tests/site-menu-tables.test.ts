import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  siteFindFirst: vi.fn(),
  execute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
  ensureSiteMediaTable: vi.fn(),
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

vi.mock("@/lib/site-media-tables", () => ({
  ensureSiteMediaTable: mocks.ensureSiteMediaTable,
}));

describe("site menu tables", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.siteFindFirst.mockReset();
    mocks.execute.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockReset();
    mocks.ensureSiteMediaTable.mockReset();

    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    mocks.ensureSiteMediaTable.mockResolvedValue(undefined);
    let dbExecuteCalls = 0;
    mocks.execute.mockImplementation(async () => {
      dbExecuteCalls += 1;
      const relationName =
        dbExecuteCalls <= 4 ? "present" : dbExecuteCalls <= 8 ? null : "present";
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

  it("rebuilds cached site menu tables when physical relations are missing", async () => {
    const { ensureSiteMenuTables } = await import("@/lib/site-menu-tables");

    const first = await ensureSiteMenuTables("site-1");
    const second = await ensureSiteMenuTables("site-1");

    expect(first.menusTable[Symbol.for("drizzle:Name")]).toBe(second.menusTable[Symbol.for("drizzle:Name")]);
    expect(first.menuItemsTable[Symbol.for("drizzle:Name")]).toBe(
      second.menuItemsTable[Symbol.for("drizzle:Name")],
    );
    expect(first.menuItemMetaTable[Symbol.for("drizzle:Name")]).toBe(
      second.menuItemMetaTable[Symbol.for("drizzle:Name")],
    );
    expect(mocks.ensureSiteMediaTable).toHaveBeenCalledWith("site-1");
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("repairs missing menu item meta sequences instead of failing cached reuse", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("to_regclass")) {
        return { rows: [{ relation_name: "present" }] };
      }
      if (statement.includes("information_schema.columns")) {
        throw Object.assign(new Error("missing legacy sequence"), { code: "42P01" });
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        throw Object.assign(new Error("missing legacy sequence"), { code: "42P01" });
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMenuTables } = await import("@/lib/site-menu-tables");

    await ensureSiteMenuTables("site-1");
    await ensureSiteMenuTables("site-1");

    expect(statements.some((statement) => statement.includes("public.tooty_site_site_1_menu_item_meta_id_seq"))).toBe(
      true,
    );
    expect(statements.some((statement) => statement.includes('ALTER COLUMN "id" SET DEFAULT nextval'))).toBe(true);
  });

  it("does not re-run repair when postgres returns the current menu meta sequence default without a schema prefix", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("to_regclass")) {
        return { rows: [{ relation_name: "present" }] };
      }
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('tooty_site_site_1_menu_item_meta_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('tooty_site_site_1_menu_item_meta_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMenuTables } = await import("@/lib/site-menu-tables");

    await ensureSiteMenuTables("site-1");
    const transactionCallsAfterFirstEnsure = mocks.transaction.mock.calls.length;
    const repairStatementsAfterFirstEnsure = statements.filter((statement) =>
      statement.includes('ALTER COLUMN "id" SET DEFAULT nextval') ||
      (statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY")),
    ).length;

    await ensureSiteMenuTables("site-1");

    expect(mocks.transaction).toHaveBeenCalledTimes(transactionCallsAfterFirstEnsure);
    expect(
      statements.filter((statement) =>
        statement.includes('ALTER COLUMN "id" SET DEFAULT nextval') ||
        (statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY")),
      ).length,
    ).toBe(repairStatementsAfterFirstEnsure);
  });

  it("reports native menu tables as unavailable without triggering table creation", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ relation_name: null }] });

    const { siteMenuTablesReady } = await import("@/lib/site-menu-tables");

    await expect(siteMenuTablesReady("site-1")).resolves.toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.ensureSiteMediaTable).not.toHaveBeenCalled();
  });
});
