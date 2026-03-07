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
    select: vi.fn(),
  },
}));

describe("site settings tables", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.siteFindFirst.mockReset();
    mocks.execute.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockReset();

    mocks.siteFindFirst.mockResolvedValue({ id: "site-1" });
    mocks.txExecute.mockResolvedValue({ rows: [{ table_name: "tooty_site_site_1_settings" }] });
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

  it("rebuilds a cached site settings table when the physical table is missing", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ table_name: null }] })
      .mockResolvedValueOnce({ rows: [{ table_name: null }] })
      .mockResolvedValueOnce({ rows: [{ table_name: null }] });

    const { ensureSiteSettingsTable } = await import("@/lib/site-settings-tables");

    const first = await ensureSiteSettingsTable("site-1");
    const second = await ensureSiteSettingsTable("site-1");

    expect(first.settingsTable).toBe("tooty_site_site_1_settings");
    expect(second.settingsTable).toBe(first.settingsTable);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});

