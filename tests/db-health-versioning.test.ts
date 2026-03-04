import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getTextSetting: vi.fn(),
  setTextSetting: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.execute,
  },
}));

vi.mock("@/lib/cms-config", () => ({
  getTextSetting: mocks.getTextSetting,
  setTextSetting: mocks.setTextSetting,
}));

import {
  applyPendingDatabaseMigrations,
  DB_SCHEMA_TARGET_VERSION_KEY,
  DB_SCHEMA_VERSION_KEY,
  TARGET_DB_SCHEMA_VERSION,
  getDatabaseHealthReport,
} from "@/lib/db-health";

const PREFIX_RAW = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const PREFIX = PREFIX_RAW.endsWith("_") ? PREFIX_RAW : `${PREFIX_RAW}_`;

const FULL_COLUMNS = [
  { table_name: `${PREFIX}site_posts`, column_name: "image" },
  { table_name: `${PREFIX}site_posts`, column_name: "imageBlurhash" },
  { table_name: `${PREFIX}site_domain_posts`, column_name: "image" },
  { table_name: `${PREFIX}site_domain_posts`, column_name: "imageBlurhash" },
  { table_name: `${PREFIX}site_domain_posts`, column_name: "password" },
  { table_name: `${PREFIX}site_domain_posts`, column_name: "usePassword" },
  { table_name: `${PREFIX}site_media`, column_name: "altText" },
  { table_name: `${PREFIX}site_media`, column_name: "caption" },
  { table_name: `${PREFIX}site_media`, column_name: "description" },
  { table_name: `${PREFIX}site_data_domains`, column_name: "description" },
  { table_name: `${PREFIX}site_term_taxonomies`, column_name: "siteId" },
];

const REQUIRED_TABLES = [
  { table_name: `${PREFIX}site_media` },
  { table_name: `${PREFIX}site_menus` },
  { table_name: `${PREFIX}site_menu_items` },
  { table_name: `${PREFIX}site_menu_item_meta` },
  { table_name: `${PREFIX}site_communication_messages` },
  { table_name: `${PREFIX}site_communication_attempts` },
  { table_name: `${PREFIX}site_webcallback_events` },
  { table_name: `${PREFIX}site_webhook_subscriptions` },
  { table_name: `${PREFIX}site_webhook_deliveries` },
  { table_name: `${PREFIX}domain_events_queue` },
  { table_name: `${PREFIX}site_term_taxonomy_meta` },
];

describe("db health version tracking", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.getTextSetting.mockReset();
    mocks.setTextSetting.mockReset();
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (_key: string, fallback: string) => fallback);
    mocks.setTextSetting.mockResolvedValue(undefined);
  });

  it("reports healthy when required columns exist and version is current", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: FULL_COLUMNS })
      .mockResolvedValueOnce({ rows: REQUIRED_TABLES });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(true);
    expect(report.migrationRequired).toBe(false);
    expect(report.pending).toEqual([]);
    expect(report.currentVersion).toBe(TARGET_DB_SCHEMA_VERSION);
    expect(report.targetVersion).toBe(TARGET_DB_SCHEMA_VERSION);
  });

  it("uses the code-defined target version even when the stored target version is stale", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: FULL_COLUMNS })
      .mockResolvedValueOnce({ rows: REQUIRED_TABLES });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return "2026.02.26.3";
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(true);
    expect(report.targetVersion).toBe(TARGET_DB_SCHEMA_VERSION);
  });

  it("requires migration when schema version is behind even with required columns", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: FULL_COLUMNS })
      .mockResolvedValueOnce({ rows: REQUIRED_TABLES });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return "2026.01.01.0";
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.02.1-version")).toBe(true);
  });

  it("requires migration when media metadata columns are missing even if the tracked version matches", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: FULL_COLUMNS.filter((entry) => entry.table_name !== `${PREFIX}site_media`),
      })
      .mockResolvedValueOnce({ rows: REQUIRED_TABLES });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.02.1-media-metadata")).toBe(true);
    expect(report.missing).toEqual([
      { table: `${PREFIX}site_media`, column: "altText" },
      { table: `${PREFIX}site_media`, column: "caption" },
      { table: `${PREFIX}site_media`, column: "description" },
    ]);
  });

  it("requires migration when site data domain description column is missing", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: FULL_COLUMNS.filter(
          (entry) => !(entry.table_name === `${PREFIX}site_data_domains` && entry.column_name === "description"),
        ),
      })
      .mockResolvedValueOnce({ rows: REQUIRED_TABLES });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.04.1-site-domain-descriptions")).toBe(true);
    expect(report.missing).toContainEqual({ table: `${PREFIX}site_data_domains`, column: "description" });
  });

  it("requires migration when taxonomy site ownership column is missing", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: FULL_COLUMNS.filter(
          (entry) => !(entry.table_name === `${PREFIX}site_term_taxonomies` && entry.column_name === "siteId"),
        ),
      })
      .mockResolvedValueOnce({ rows: REQUIRED_TABLES });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.04.2-site-taxonomies")).toBe(true);
    expect(report.missing).toContainEqual({ table: `${PREFIX}site_term_taxonomies`, column: "siteId" });
  });

  it("requires migration when native menu tables are missing even if the tracked version matches", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: FULL_COLUMNS })
      .mockResolvedValueOnce({
        rows: REQUIRED_TABLES.filter((entry) => !entry.table_name.startsWith(`${PREFIX}site_menu`)),
      });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.02.1-native-menus")).toBe(true);
    expect(report.missingTables).toEqual([
      `${PREFIX}site_menus`,
      `${PREFIX}site_menu_items`,
      `${PREFIX}site_menu_item_meta`,
    ]);
  });

  it("applyPendingDatabaseMigrations updates tracked schema version", async () => {
    await applyPendingDatabaseMigrations();

    expect(mocks.setTextSetting).toHaveBeenCalledWith(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
    expect(mocks.setTextSetting).toHaveBeenCalledWith(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  });

  it("is idempotent across two migration runs with no duplicate state or version drift", async () => {
    const settingState = new Map<string, string>();
    mocks.setTextSetting.mockImplementation(async (key: string, value: string) => {
      settingState.set(key, value);
    });

    await applyPendingDatabaseMigrations();
    const executeCallsFirstRun = mocks.execute.mock.calls.length;
    const updatedAtAfterFirstRun = settingState.get("db_schema_updated_at");

    await applyPendingDatabaseMigrations();
    const executeCallsSecondRun = mocks.execute.mock.calls.length - executeCallsFirstRun;
    const updatedAtAfterSecondRun = settingState.get("db_schema_updated_at");

    // 1) Runs migration twice.
    expect(executeCallsFirstRun).toBeGreaterThan(0);
    expect(executeCallsSecondRun).toBe(executeCallsFirstRun);

    // 2) No duplicate state keys.
    expect(Array.from(settingState.keys()).sort()).toEqual([
      "db_schema_target_version",
      "db_schema_updated_at",
      "db_schema_version",
    ]);

    // 3) No version drift.
    expect(settingState.get(DB_SCHEMA_VERSION_KEY)).toBe(TARGET_DB_SCHEMA_VERSION);
    expect(settingState.get(DB_SCHEMA_TARGET_VERSION_KEY)).toBe(TARGET_DB_SCHEMA_VERSION);

    // 4) No partial reapplication: each run fully reaches schema-current marker update.
    expect(String(updatedAtAfterFirstRun || "").length).toBeGreaterThan(0);
    expect(String(updatedAtAfterSecondRun || "").length).toBeGreaterThan(0);
  });
});
