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
    expect(report.pending.some((entry) => entry.id === "2026.02.26.1-version")).toBe(true);
  });

  it("applyPendingDatabaseMigrations updates tracked schema version", async () => {
    await applyPendingDatabaseMigrations();

    expect(mocks.setTextSetting).toHaveBeenCalledWith(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
    expect(mocks.setTextSetting).toHaveBeenCalledWith(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  });
});
