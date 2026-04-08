import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  ensureSiteSettingsTable: vi.fn(),
  listSiteSettingsRegistries: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.execute,
    transaction: mocks.transaction,
    query: {
      systemSettings: {
        findFirst: mocks.findFirst,
      },
    },
  },
}));

vi.mock("@/lib/site-settings-tables", () => ({
  ensureSiteSettingsTable: mocks.ensureSiteSettingsTable,
  listSiteSettingsRegistries: mocks.listSiteSettingsRegistries,
}));

describe("settings-store bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.execute.mockReset();
    mocks.transaction.mockReset();
    mocks.findFirst.mockReset();
    mocks.ensureSiteSettingsTable.mockReset();
    mocks.listSiteSettingsRegistries.mockReset();
    delete process.env.CMS_DB_PREFIX;
  });

  it("tolerates duplicate pg_type races while ensuring the network settings table", async () => {
    const duplicateTypeError = Object.assign(new Error("duplicate type"), {
      code: "23505",
      constraint: "pg_type_typname_nsp_index",
    });

    let createFailed = false;
    let tableVisible = false;
    mocks.transaction.mockImplementation(async (callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
      callback({ execute: mocks.execute }),
    );
    mocks.execute.mockImplementation(async (statement: any) => {
      const chunks = Array.isArray(statement?.queryChunks) ? statement.queryChunks : [];
      const text = chunks
        .map((chunk: any) => {
          if (typeof chunk === "string") return chunk;
          if (Array.isArray(chunk?.value)) return chunk.value.join("");
          return "";
        })
        .join("");

      if (text.includes("CREATE TABLE IF NOT EXISTS") && text.includes("\"tooty_network_system_settings\"") && !createFailed) {
        createFailed = true;
        throw duplicateTypeError;
      }

      if (text.includes("CREATE TABLE IF NOT EXISTS") && text.includes("\"tooty_network_system_settings\"")) {
        tableVisible = true;
        return { rows: [] };
      }

      if (text.includes("SELECT to_regclass(") && text.includes("tooty_network_system_settings")) {
        if (createFailed && !tableVisible) {
          tableVisible = true;
        }
        return { rows: [{ table_name: tableVisible ? "tooty_network_system_settings" : null }] };
      }

      if (text.includes("SELECT 1 FROM \"tooty_network_system_settings\"")) {
        throw new Error("stale direct relation read should not happen during duplicate-type recovery");
      }

      return { rows: [] };
    });
    mocks.findFirst.mockResolvedValue({ value: "https://example.com" });

    const { getSettingByKey } = await import("@/lib/settings-store");

    await expect(getSettingByKey("site_url")).resolves.toBe("https://example.com");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: expect.anything(),
      columns: { value: true },
    });
  });
});
