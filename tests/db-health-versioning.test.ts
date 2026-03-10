import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getTextSetting: vi.fn(),
  setTextSetting: vi.fn(),
  listSiteDomainDefinitions: vi.fn(async () => []),
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

vi.mock("@/lib/site-settings-tables", () => ({
  ensureSiteSettingsTable: vi.fn(async () => ({ settingsTable: "ignored" })),
}));

vi.mock("@/lib/site-user-tables", () => ({
  ensureSiteUserTables: vi.fn(async () => ({ usersTable: "ignored", userMetaTable: "ignored" })),
}));

vi.mock("@/lib/site-comment-tables", () => ({
  ensureSiteCommentTables: vi.fn(async () => ({ commentsTable: "ignored", commentMetaTable: "ignored" })),
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  ensureSiteDataDomainTable: vi.fn(async () => undefined),
}));

vi.mock("@/lib/default-data-domains", () => ({
  ensureDefaultCoreDataDomains: vi.fn(async () => undefined),
}));

vi.mock("@/lib/site-domain-type-tables", () => ({
  ensureSiteDomainTypeTables: vi.fn(async () => ({ contentTable: "ignored", metaTable: "ignored" })),
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  listSiteDomainDefinitions: mocks.listSiteDomainDefinitions,
}));

const mediaTableMocks = vi.hoisted(() => ({
  ensureSiteMediaTable: vi.fn(async () => ({ mediaTable: "ignored" })),
}));

vi.mock("@/lib/site-media-tables", () => mediaTableMocks);

const menuTableMocks = vi.hoisted(() => ({
  ensureSiteMenuTables: vi.fn(async () => ({
    menusTable: "ignored",
    menuItemsTable: "ignored",
    menuItemMetaTable: "ignored",
  })),
}));

vi.mock("@/lib/site-menu-tables", () => menuTableMocks);

const taxonomyTableMocks = vi.hoisted(() => ({
  ensureSiteTaxonomyTables: vi.fn(async () => ({
    termsTable: "ignored",
    termTaxonomiesTable: "ignored",
    termRelationshipsTable: "ignored",
    termTaxonomyDomainsTable: "ignored",
    termTaxonomyMetaTable: "ignored",
  })),
}));

vi.mock("@/lib/site-taxonomy-tables", () => taxonomyTableMocks);

import {
  applyPendingDatabaseMigrations,
  DB_SCHEMA_TARGET_VERSION_KEY,
  DB_SCHEMA_VERSION_KEY,
  TARGET_DB_SCHEMA_VERSION,
  getDatabaseHealthReport,
  networkSequenceName,
} from "@/lib/db-health";

const PREFIX_RAW = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const PREFIX = PREFIX_RAW.endsWith("_") ? PREFIX_RAW : `${PREFIX_RAW}_`;

const REQUIRED_NETWORK_TABLES = [
  { table_name: `${PREFIX}network_accounts` },
  { table_name: `${PREFIX}network_communication_attempts` },
  { table_name: `${PREFIX}network_communication_messages` },
  { table_name: `${PREFIX}network_rbac_roles` },
  { table_name: `${PREFIX}network_sessions` },
  { table_name: `${PREFIX}network_sites` },
  { table_name: `${PREFIX}network_system_settings` },
  { table_name: `${PREFIX}network_user_meta` },
  { table_name: `${PREFIX}network_users` },
  { table_name: `${PREFIX}network_verification_tokens` },
  { table_name: `${PREFIX}network_webcallback_events` },
  { table_name: `${PREFIX}network_webhook_deliveries` },
  { table_name: `${PREFIX}network_webhook_subscriptions` },
];

describe("db health version tracking", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.getTextSetting.mockReset();
    mocks.setTextSetting.mockReset();
    mediaTableMocks.ensureSiteMediaTable.mockClear();
    menuTableMocks.ensureSiteMenuTables.mockClear();
    taxonomyTableMocks.ensureSiteTaxonomyTables.mockClear();
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (_key: string, fallback: string) => fallback);
    mocks.setTextSetting.mockResolvedValue(undefined);
  });

  it("reports healthy when required network tables exist and version is current", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: REQUIRED_NETWORK_TABLES })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(true);
    expect(report.migrationRequired).toBe(false);
    expect(report.pending).toEqual([]);
    expect(report.missing).toEqual([]);
  });

  it("uses the code-defined target version even when the stored target version is stale", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: REQUIRED_NETWORK_TABLES })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return "2026.02.26.3";
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(true);
    expect(report.targetVersion).toBe(TARGET_DB_SCHEMA_VERSION);
  });

  it("requires migration when schema version is behind even if tables are present", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: REQUIRED_NETWORK_TABLES })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return "2026.01.01.0";
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.08.0-version")).toBe(true);
  });

  it("requires migration when required network tables are missing", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: REQUIRED_NETWORK_TABLES.filter((row) => row.table_name !== `${PREFIX}network_sites`) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.08.0-network-tables")).toBe(true);
    expect(report.missingTables).toContain(`${PREFIX}network_sites`);
  });

  it("requires migration when shared feature tables still exist", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: REQUIRED_NETWORK_TABLES })
      .mockResolvedValueOnce({ rows: [{ table_name: `${PREFIX}site_media` }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.08.0-drop-shared-feature-tables")).toBe(true);
    expect(report.disallowedFound).toEqual([`${PREFIX}site_media`]);
  });

  it("requires migration when obsolete registry tables still exist", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: REQUIRED_NETWORK_TABLES })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_name: `${PREFIX}site_user_table_registry` }] });
    mocks.getTextSetting.mockImplementation(async (key: string, fallback: string) => {
      if (key === DB_SCHEMA_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      if (key === DB_SCHEMA_TARGET_VERSION_KEY) return TARGET_DB_SCHEMA_VERSION;
      return fallback;
    });

    const report = await getDatabaseHealthReport();

    expect(report.ok).toBe(false);
    expect(report.migrationRequired).toBe(true);
    expect(report.pending.some((entry) => entry.id === "2026.03.08.0-drop-obsolete-registries")).toBe(true);
    expect(report.obsoleteRegistryFound).toEqual([`${PREFIX}site_user_table_registry`]);
  });

  it("applyPendingDatabaseMigrations updates tracked schema version", async () => {
    await applyPendingDatabaseMigrations();

    expect(mocks.setTextSetting).toHaveBeenCalledWith(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
    expect(mocks.setTextSetting).toHaveBeenCalledWith(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  });

  it("routes site-scoped bootstrap through the locked site helper families", async () => {
    mocks.execute.mockImplementation(async (statement: unknown) => {
      const text = Array.isArray((statement as { queryChunks?: Array<{ value?: string[] }> } | null)?.queryChunks)
        ? (statement as { queryChunks: Array<{ value?: string[] }> }).queryChunks
            .flatMap((chunk) => chunk.value || [])
            .join("")
        : String(statement ?? "");
      if (text.includes('SELECT "id" FROM')) {
        return { rows: [{ id: "site-under-load" }] };
      }
      return { rows: [] };
    });

    await applyPendingDatabaseMigrations();

    expect(mediaTableMocks.ensureSiteMediaTable).toHaveBeenCalledWith("site-under-load");
    expect(menuTableMocks.ensureSiteMenuTables).toHaveBeenCalledWith("site-under-load");
    expect(taxonomyTableMocks.ensureSiteTaxonomyTables).toHaveBeenCalledWith("site-under-load");
  });

  it("renames legacy view_count rows to _view_count during compatibility fixes", async () => {
    mocks.listSiteDomainDefinitions.mockResolvedValueOnce([
      { key: "post", metaTable: "tooty_site_site-under-load_domain_post_meta" },
    ]);
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (statement: unknown) => {
      const text = Array.isArray((statement as { queryChunks?: Array<{ value?: string[] }> } | null)?.queryChunks)
        ? (statement as { queryChunks: Array<{ value?: string[] }> }).queryChunks
            .flatMap((chunk) => chunk.value || [])
            .join("")
        : String(statement ?? "");
      statements.push(text);
      if (text.includes('SELECT "id" FROM')) {
        return { rows: [{ id: "site-under-load" }] };
      }
      return { rows: [] };
    });

    await applyPendingDatabaseMigrations();

    expect(statements.some((text) => text.includes('DELETE FROM "tooty_site_site-under-load_domain_post_meta" legacy'))).toBe(true);
    expect(statements.some((text) => text.includes('SET "key" = \'_view_count\''))).toBe(true);
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

    expect(executeCallsFirstRun).toBeGreaterThan(0);
    expect(executeCallsSecondRun).toBe(executeCallsFirstRun);
    expect(Array.from(settingState.keys()).sort()).toEqual([
      "db_schema_target_version",
      "db_schema_updated_at",
      "db_schema_version",
    ]);
    expect(settingState.get(DB_SCHEMA_VERSION_KEY)).toBe(TARGET_DB_SCHEMA_VERSION);
    expect(settingState.get(DB_SCHEMA_TARGET_VERSION_KEY)).toBe(TARGET_DB_SCHEMA_VERSION);
    expect(String(updatedAtAfterFirstRun || "").length).toBeGreaterThan(0);
    expect(String(updatedAtAfterSecondRun || "").length).toBeGreaterThan(0);
  });

  it("derives distinct explicit sequence names for long network tables that would collide under serial truncation", () => {
    const first = networkSequenceName("tooty_test_3123_network_webcallback_events");
    const second = networkSequenceName("tooty_test_3124_network_webcallback_events");

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(second.length).toBeLessThanOrEqual(63);
    expect(first.endsWith("_seq")).toBe(true);
    expect(second.endsWith("_seq")).toBe(true);
  });
});
