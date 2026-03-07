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

function queryText(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const chunks = Array.isArray((input as { queryChunks?: unknown[] }).queryChunks)
    ? ((input as { queryChunks?: unknown[] }).queryChunks as unknown[])
    : [];
  return chunks.map((chunk) => String((chunk as { value?: unknown })?.value ?? "")).join(" ");
}

function defaultExecuteResult(input: unknown) {
  const text = queryText(input);
  if (text.includes("to_regclass(")) {
    return { rows: [{ table_name: "relation" }] };
  }
  if (text.includes("information_schema.columns")) {
    return {
      rows: [
        {
          column_default: "nextval('public.tooty_site_site_1_data_domains_id_seq'::regclass)",
        },
      ],
    };
  }
  return { rows: [] };
}

describe("site data domain registry", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CMS_DB_PREFIX = "tooty_";
    mocks.siteFindFirst.mockReset();
    mocks.execute.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockReset();

    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    mocks.execute.mockImplementation(async (input: unknown) => defaultExecuteResult(input));
    mocks.txExecute.mockImplementation(async (input: unknown) => defaultExecuteResult(input));
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

  it("bootstraps site data domain tables without throwing when compatibility columns are missing", async () => {
    const { ensureSiteDataDomainTable } = await import("@/lib/site-data-domain-registry");
    mocks.txExecute.mockImplementation(async (input: unknown) => {
      const text = queryText(input);
      if (text.includes("to_regclass(")) {
        return { rows: [{ table_name: "relation" }] };
      }
      if (text.includes("information_schema.columns")) {
        return { rows: [{ column_default: null }] };
      }
      return { rows: [] };
    });

    await ensureSiteDataDomainTable("site-1");

    expect(mocks.execute).toHaveBeenCalled();
  });

  it("retries site data domain reads when a deadlock escapes during list operations", async () => {
    const { ensureSiteDataDomainTable, listSiteDataDomains } = await import("@/lib/site-data-domain-registry");

    await ensureSiteDataDomainTable("site-1");

    mocks.execute.mockReset();
    let readAttempts = 0;
    mocks.execute.mockImplementation(async (input: unknown) => {
      const text = queryText(input);
      if (text.includes("to_regclass(")) {
        return { rows: [{ table_name: "tooty_site_site_1_data_domains" }] };
      }
      if (text.includes("information_schema.columns")) {
        return {
          rows: [
            {
              column_default: "nextval('public.tooty_site_site_1_data_domains_id_seq'::regclass)",
            },
          ],
        };
      }
      readAttempts += 1;
      if (readAttempts === 1) {
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      }
      return {
        rows: [
          {
            id: 1,
            key: "post",
            label: "Post",
            contentTable: "tooty_site_site_1_post",
            metaTable: "tooty_site_site_1_post_meta",
            description: "Post domain",
            settings: {},
            isActive: true,
          },
        ],
      };
    });

    const rows = await listSiteDataDomains("site-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("post");
    expect(mocks.execute).toHaveBeenCalledTimes(5);
  });
});
