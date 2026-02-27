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

const FULL_COLUMNS = [
  { table_name: "tooty_posts", column_name: "image" },
  { table_name: "tooty_posts", column_name: "imageBlurhash" },
  { table_name: "tooty_domain_posts", column_name: "image" },
  { table_name: "tooty_domain_posts", column_name: "imageBlurhash" },
  { table_name: "tooty_domain_posts", column_name: "password" },
  { table_name: "tooty_domain_posts", column_name: "usePassword" },
];

const REQUIRED_TABLES = [
  { table_name: "tooty_communication_messages" },
  { table_name: "tooty_communication_attempts" },
  { table_name: "tooty_webcallback_events" },
  { table_name: "tooty_webhook_subscriptions" },
  { table_name: "tooty_webhook_deliveries" },
  { table_name: "tooty_domain_events_queue" },
  { table_name: "tooty_term_taxonomy_meta" },
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
    expect(report.pending.some((entry) => entry.id === "2026.02.26.3-version")).toBe(true);
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
