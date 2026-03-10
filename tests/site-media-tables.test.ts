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

describe("site media tables", () => {
  let dbExecuteCalls = 0;

  beforeEach(() => {
    vi.resetModules();
    mocks.siteFindFirst.mockReset();
    mocks.execute.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockReset();

    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    dbExecuteCalls = 0;
    mocks.execute.mockImplementation(async () => {
      dbExecuteCalls += 1;
      const relationName =
        dbExecuteCalls <= 2 ? "present" : dbExecuteCalls <= 4 ? null : "present";
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

  it("rebuilds cached site media tables when the physical table or sequence is missing", async () => {
    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    const first = await ensureSiteMediaTable("site-1");
    const second = await ensureSiteMediaTable("site-1");

    expect(first[Symbol.for("drizzle:Name")]).toBe(second[Symbol.for("drizzle:Name")]);
    expect(mocks.transaction.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("treats opaque executors as already provisioned instead of fabricating pending relation errors", async () => {
    mocks.execute.mockReset();
    mocks.transaction.mockReset();
    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    mocks.execute.mockImplementation(async () => undefined);
    mocks.transaction.mockImplementation(async () => undefined);

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await expect(ensureSiteMediaTable("site-1")).resolves.toBeUndefined();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("reports site media tables as ready only when both the table and sequence exist", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ relation_name: "present" }] });
    mocks.execute.mockResolvedValueOnce({ rows: [{ relation_name: null }] });

    const { siteMediaTableReady } = await import("@/lib/site-media-tables");

    await expect(siteMediaTableReady("site-1")).resolves.toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("repairs the id default and sequence ownership when ensuring the physical table", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      dbExecuteCalls += 1;
      return { rows: [{ relation_name: dbExecuteCalls <= 2 ? null : "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await ensureSiteMediaTable("site-1");

    expect(statements.some((statement) => statement.includes('ALTER COLUMN "id" SET DEFAULT nextval'))).toBe(true);
    expect(statements.some((statement) => statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY"))).toBe(
      true,
    );
  });

  it("repairs the id default and sequence ownership even when the table and sequence already exist", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return {
          rows: [{ column_default: "nextval('tooty_site_site_1_media_id_seq'::regclass)" }],
        };
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await ensureSiteMediaTable("site-1");
    const transactionCallsAfterFirstEnsure = mocks.transaction.mock.calls.length;
    await ensureSiteMediaTable("site-1");

    expect(mocks.transaction).toHaveBeenCalledTimes(transactionCallsAfterFirstEnsure);
    expect(statements.some((statement) => statement.includes('ALTER COLUMN "id" SET DEFAULT nextval'))).toBe(true);
    expect(statements.some((statement) => statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY"))).toBe(
      true,
    );
  });

  it("does not re-run repair when postgres returns the current sequence default without a schema prefix", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('tooty_site_site_1_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('tooty_site_site_1_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await ensureSiteMediaTable("site-1");
    const transactionCallsAfterFirstEnsure = mocks.transaction.mock.calls.length;
    const repairStatementsAfterFirstEnsure = statements.filter((statement) =>
      statement.includes('ALTER COLUMN "id" SET DEFAULT nextval') ||
      (statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY")),
    ).length;

    await ensureSiteMediaTable("site-1");

    expect(mocks.transaction).toHaveBeenCalledTimes(transactionCallsAfterFirstEnsure);
    expect(
      statements.filter((statement) =>
        statement.includes('ALTER COLUMN "id" SET DEFAULT nextval') ||
        (statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY")),
      ).length,
    ).toBe(repairStatementsAfterFirstEnsure);
  });

  it("recreates a missing media id sequence before repairing the table default", async () => {
    const statements: string[] = [];
    let relationChecks = 0;
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      if (statement.includes("to_regclass")) {
        relationChecks += 1;
        return { rows: [{ relation_name: relationChecks === 2 ? null : "present" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await ensureSiteMediaTable("site-1");
    await ensureSiteMediaTable("site-1");

    expect(statements.some((statement) => statement.includes("CREATE SEQUENCE IF NOT EXISTS"))).toBe(true);
    expect(statements.some((statement) => statement.includes('ALTER COLUMN "id" SET DEFAULT nextval'))).toBe(true);
  });

  it("retries id default repair when postgres reports the media sequence is missing", async () => {
    const statements: string[] = [];
    let alterAttempts = 0;
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("ALTER TABLE") && statement.includes('ALTER COLUMN "id" SET DEFAULT nextval')) {
        alterAttempts += 1;
        if (alterAttempts === 1) {
          throw Object.assign(new Error("missing sequence"), { code: "42P01" });
        }
      }
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await ensureSiteMediaTable("site-1");

    expect(alterAttempts).toBeGreaterThanOrEqual(2);
    expect(statements.filter((statement) => statement.includes("CREATE SEQUENCE IF NOT EXISTS")).length).toBeGreaterThan(
      0,
    );
  });

  it("rebuilds the media table when sequence ownership repair still surfaces a missing relation", async () => {
    const statements: string[] = [];
    let missingOwnershipErrorThrown = false;
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      if (!missingOwnershipErrorThrown && statement.includes("ALTER SEQUENCE") && statement.includes("OWNED BY")) {
        missingOwnershipErrorThrown = true;
        throw Object.assign(new Error("missing sequence during ownership repair"), {
          code: "42P01",
          message: 'relation "public.tooty_site_site_1_media_id_seq" does not exist',
        });
      }
      if (statement.includes("information_schema.columns")) {
        return { rows: [{ column_default: "nextval('legacy_media_id_seq'::regclass)" }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await expect(ensureSiteMediaTable("site-1")).resolves.toBeDefined();

    expect(mocks.transaction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(statements.filter((statement) => statement.includes("CREATE SEQUENCE IF NOT EXISTS")).length).toBeGreaterThan(
      1,
    );
  });

  it("treats missing legacy default sequence introspection as repair-needed instead of fatal", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
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

    const { ensureSiteMediaTable } = await import("@/lib/site-media-tables");

    await ensureSiteMediaTable("site-1");
    await ensureSiteMediaTable("site-1");

    expect(statements.some((statement) => statement.includes("public.tooty_site_site_1_media_id_seq"))).toBe(true);
    expect(statements.some((statement) => statement.includes('ALTER COLUMN "id" SET DEFAULT nextval'))).toBe(true);
  });
});
