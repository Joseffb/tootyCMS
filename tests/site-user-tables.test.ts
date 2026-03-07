import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  roleFindFirst: vi.fn(),
  siteFindFirst: vi.fn(),
  select: vi.fn(),
  fromSites: vi.fn(),
  execute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    select: mocks.select,
    query: {
      sites: {
        findFirst: mocks.siteFindFirst,
      },
      users: {
        findFirst: mocks.userFindFirst,
      },
      rbacRoles: {
        findFirst: mocks.roleFindFirst,
      },
    },
    execute: mocks.execute,
    transaction: mocks.transaction,
  },
}));

describe("site user tables", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.userFindFirst.mockReset();
    mocks.roleFindFirst.mockReset();
    mocks.siteFindFirst.mockReset();
    mocks.select.mockReset();
    mocks.fromSites.mockReset();
    mocks.execute.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockReset();
    mocks.select.mockReturnValue({
      from: mocks.fromSites,
    });
    mocks.fromSites.mockResolvedValue([
      { siteId: "site-1" },
      { siteId: "site-2" },
    ]);
    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    mocks.roleFindFirst.mockResolvedValue(null);
    mocks.execute.mockResolvedValue({ rows: [{ relation_name: "present" }] });
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

  it("does not write site user role when parent user row is missing", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    const { upsertSiteUserRole } = await import("@/lib/site-user-tables");

    await upsertSiteUserRole("site-1", "missing-user", "author");

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns all sites for network-level site managers without per-site membership lookup", async () => {
    mocks.userFindFirst.mockResolvedValue({ role: "network admin" });
    mocks.roleFindFirst.mockResolvedValue({
      capabilities: {
        "network.site.manage": true,
      },
    });
    const { listSiteIdsForUser } = await import("@/lib/site-user-tables");

    const siteIds = await listSiteIdsForUser("user-1");

    expect(siteIds).toEqual(["site-1", "site-2"]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("builds site user tables against network users, not the removed shared users table", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "user-1" }).mockResolvedValueOnce({ role: "author" });
    const statements: string[] = [];
    mocks.execute.mockResolvedValue({ rows: [{ relation_name: "present" }] });
    mocks.txExecute.mockImplementation(async (query: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      statements.push(statement);
      return { rows: [{ relation_name: "present" }] };
    });

    const { upsertSiteUserRole } = await import("@/lib/site-user-tables");

    await upsertSiteUserRole("site-1", "user-1", "author");

    const ddl = statements.join("\n");
    expect(ddl).toContain('REFERENCES "tooty_network_users"("id")');
    expect(ddl).not.toContain('REFERENCES "tooty_users"("id")');
  });

  it("rebuilds cached site user tables when the physical relations are missing", async () => {
    let relationChecks = 0;
    mocks.execute.mockImplementation(async () => {
      relationChecks += 1;
      return { rows: [{ relation_name: relationChecks === 4 ? null : "present" }] };
    });
    mocks.txExecute.mockResolvedValue({ rows: [{ relation_name: "present" }] });

    const { ensureSiteUserTables } = await import("@/lib/site-user-tables");

    await ensureSiteUserTables("site-1");
    await ensureSiteUserTables("site-1");

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("retries site user reads when a cached physical users table disappears", async () => {
    let relationChecks = 0;
    let selectAttempts = 0;
    mocks.userFindFirst.mockResolvedValue({ role: "author" });
    mocks.execute.mockImplementation(async (query?: { queryChunks?: Array<{ value?: string }> }) => {
      const statement = String(query?.queryChunks?.[0]?.value || "");
      if (statement.includes("to_regclass")) {
        relationChecks += 1;
        return { rows: [{ relation_name: relationChecks <= 3 ? "present" : "present" }] };
      }
      if (statement.includes('SELECT "role", "is_active"')) {
        selectAttempts += 1;
        if (selectAttempts === 1) {
          throw Object.assign(new Error('relation "tooty_site_site_1_users" does not exist'), { code: "42P01" });
        }
        return { rows: [{ role: "author", is_active: true }] };
      }
      return { rows: [{ relation_name: "present" }] };
    });
    mocks.txExecute.mockResolvedValue({ rows: [{ relation_name: "present" }] });

    const { getSiteUserRole } = await import("@/lib/site-user-tables");

    await expect(getSiteUserRole("site-1", "user-1")).resolves.toBe("author");
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});
