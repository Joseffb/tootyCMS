import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstallState: vi.fn(),
  saveSetupEnvValues: vi.fn(),
  siteFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  dbExecute: vi.fn(),
  insertReturning: vi.fn(),
  updateWhere: vi.fn(),
  hashPassword: vi.fn(),
  advanceSetupLifecycleTo: vi.fn(),
  ensureDefaultCoreDataDomains: vi.fn(),
  ensureMainSiteForUser: vi.fn(),
  listSiteIdsForUser: vi.fn(),
  setSettingByKey: vi.fn(),
  sitePluginEnabledKey: vi.fn(),
  getPluginById: vi.fn(),
  getAvailableThemes: vi.fn(),
  setSiteTheme: vi.fn(),
  setThemeEnabled: vi.fn(),
  getSetupDefaultPluginIds: vi.fn(),
  getSetupDefaultThemeId: vi.fn(),
  applyFirstRunNetworkSchemaBootstrap: vi.fn(),
  applyPendingDatabaseMigrations: vi.fn(),
  getDatabaseHealthReport: vi.fn(),
  markDatabaseSchemaCurrent: vi.fn(),
  SetupEnvPersistenceError: class MockSetupEnvPersistenceError extends Error {
    status = 409;
    code = "SETUP_ENV_PERSISTENCE_FAILED";
  },
}));

vi.mock("@/lib/install-state", () => ({
  getInstallState: mocks.getInstallState,
}));

vi.mock("@/lib/setup-env", () => ({
  saveSetupEnvValues: mocks.saveSetupEnvValues,
  SetupEnvPersistenceError: mocks.SetupEnvPersistenceError,
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.dbExecute,
    query: {
      users: {
        findFirst: mocks.userFindFirst,
      },
      sites: {
        findMany: mocks.siteFindMany,
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mocks.insertReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mocks.updateWhere,
      })),
    })),
  },
}));

vi.mock("@/lib/schema", () => ({
  sites: { id: "id" },
  users: { id: "id" },
}));

vi.mock("@/lib/password", () => ({
  hashPassword: mocks.hashPassword,
}));

vi.mock("@/lib/rbac", () => ({
  NETWORK_ADMIN_ROLE: "network_admin",
}));

vi.mock("@/lib/setup-lifecycle", () => ({
  advanceSetupLifecycleTo: mocks.advanceSetupLifecycleTo,
}));

vi.mock("@/lib/default-data-domains", () => ({
  ensureDefaultCoreDataDomains: mocks.ensureDefaultCoreDataDomains,
}));

vi.mock("@/lib/bootstrap", () => ({
  ensureMainSiteForUser: mocks.ensureMainSiteForUser,
}));

vi.mock("@/lib/site-user-tables", () => ({
  listSiteIdsForUser: mocks.listSiteIdsForUser,
}));

vi.mock("@/lib/settings-store", () => ({
  setSettingByKey: mocks.setSettingByKey,
}));

vi.mock("@/lib/plugins", () => ({
  sitePluginEnabledKey: mocks.sitePluginEnabledKey,
  getPluginById: mocks.getPluginById,
}));

vi.mock("@/lib/themes", () => ({
  getAvailableThemes: mocks.getAvailableThemes,
  setSiteTheme: mocks.setSiteTheme,
  setThemeEnabled: mocks.setThemeEnabled,
}));

vi.mock("@/lib/setup-defaults", () => ({
  getSetupDefaultPluginIds: mocks.getSetupDefaultPluginIds,
  getSetupDefaultThemeId: mocks.getSetupDefaultThemeId,
}));

vi.mock("@/lib/db-health", () => ({
  applyFirstRunNetworkSchemaBootstrap: mocks.applyFirstRunNetworkSchemaBootstrap,
  applyPendingDatabaseMigrations: mocks.applyPendingDatabaseMigrations,
  getDatabaseHealthReport: mocks.getDatabaseHealthReport,
  markDatabaseSchemaCurrent: mocks.markDatabaseSchemaCurrent,
}));

import { POST } from "@/app/api/setup/env/route";

describe("setup env route", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CMS_DB_PREFIX = "robertbetan_";
    delete process.env.SETUP_DB_INIT_URL;
    delete process.env.SETUP_DB_INIT_BACKEND;

    mocks.getInstallState.mockReset();
    mocks.saveSetupEnvValues.mockReset();
    mocks.siteFindMany.mockReset();
    mocks.userFindFirst.mockReset();
    mocks.dbExecute.mockReset();
    mocks.insertReturning.mockReset();
    mocks.updateWhere.mockReset();
    mocks.hashPassword.mockReset();
    mocks.advanceSetupLifecycleTo.mockReset();
    mocks.ensureDefaultCoreDataDomains.mockReset();
    mocks.ensureMainSiteForUser.mockReset();
    mocks.listSiteIdsForUser.mockReset();
    mocks.setSettingByKey.mockReset();
    mocks.sitePluginEnabledKey.mockReset();
    mocks.getPluginById.mockReset();
    mocks.getAvailableThemes.mockReset();
    mocks.setSiteTheme.mockReset();
    mocks.setThemeEnabled.mockReset();
    mocks.getSetupDefaultPluginIds.mockReset();
    mocks.getSetupDefaultThemeId.mockReset();
    mocks.applyFirstRunNetworkSchemaBootstrap.mockReset();
    mocks.applyPendingDatabaseMigrations.mockReset();
    mocks.getDatabaseHealthReport.mockReset();
    mocks.markDatabaseSchemaCurrent.mockReset();

    mocks.getInstallState.mockResolvedValue({ setupRequired: true });
    mocks.saveSetupEnvValues.mockResolvedValue({ backend: "local", persisted: true });
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.insertReturning.mockResolvedValue([{ id: "user-1" }]);
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.siteFindMany.mockResolvedValue([{ id: "site-1", isPrimary: true, subdomain: "main" }]);
    mocks.listSiteIdsForUser.mockResolvedValue(["site-1"]);
    mocks.sitePluginEnabledKey.mockReturnValue("plugin_key");
    mocks.getPluginById.mockResolvedValue(null);
    mocks.getAvailableThemes.mockResolvedValue([]);
    mocks.getSetupDefaultPluginIds.mockReturnValue([]);
    mocks.getSetupDefaultThemeId.mockReturnValue(null);
    mocks.applyFirstRunNetworkSchemaBootstrap.mockResolvedValue(undefined);
    mocks.getDatabaseHealthReport.mockResolvedValue({
      migrationRequired: false,
      pending: [],
      missingTables: [],
      disallowedFound: [],
      obsoleteRegistryFound: [],
    });
    mocks.markDatabaseSchemaCurrent.mockResolvedValue(undefined);
    mocks.applyPendingDatabaseMigrations.mockResolvedValue(undefined);
    mocks.ensureDefaultCoreDataDomains.mockResolvedValue(new Map());
    mocks.ensureMainSiteForUser.mockResolvedValue(undefined);
    mocks.advanceSetupLifecycleTo.mockResolvedValue(undefined);
    mocks.setSettingByKey.mockResolvedValue(undefined);

    let existsCall = 0;
    mocks.dbExecute.mockImplementation(async () => {
      existsCall += 1;
      if (existsCall <= 19) return { rows: [{ exists: false }] };
      return { rows: [{ exists: true }] };
    });
  });

  it("bootstraps required tables locally when setup starts from an empty database", async () => {
    const response = await POST(
      new Request("http://localhost/api/setup/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            POSTGRES_URL: "postgres://example",
            CMS_DB_PREFIX: "robertbetan_",
          },
          adminName: "Admin User",
          adminEmail: "admin@example.com",
          adminPhone: "",
          adminPassword: "password123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.applyFirstRunNetworkSchemaBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.markDatabaseSchemaCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.applyPendingDatabaseMigrations).not.toHaveBeenCalled();

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.dbInitialized).toBe(true);
  });

  it("uses the submitted setup prefix for schema bootstrap and restores process env after setup", async () => {
    process.env.CMS_DB_PREFIX = "";
    mocks.applyFirstRunNetworkSchemaBootstrap.mockImplementation(async () => {
      expect(process.env.CMS_DB_PREFIX).toBe("robertbetan_");
      expect(process.env.POSTGRES_URL).toBe("postgres://example");
    });
    mocks.markDatabaseSchemaCurrent.mockImplementation(async () => {
      expect(process.env.CMS_DB_PREFIX).toBe("robertbetan_");
    });

    const response = await POST(
      new Request("http://localhost/api/setup/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            POSTGRES_URL: "postgres://example",
            CMS_DB_PREFIX: "robertbetan_",
          },
          adminName: "Admin User",
          adminEmail: "admin@example.com",
          adminPhone: "",
          adminPassword: "password123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(process.env.CMS_DB_PREFIX).toBe("");
  });

  it("clears stale auth cookies and pins admin routing to the new main site on setup success", async () => {
    const response = await POST(
      new Request("http://localhost/api/setup/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            POSTGRES_URL: "postgres://example",
            CMS_DB_PREFIX: "robertbetan_",
          },
          adminName: "Admin User",
          adminEmail: "admin@example.com",
          adminPhone: "",
          adminPassword: "password123",
        }),
      }),
    );

    expect(response.status).toBe(200);

    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookie = typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers).join("\n")
      : String(response.headers.get("set-cookie") || "");

    expect(setCookie).toContain("cms_last_site_id=site-1");
    expect(setCookie).toContain("cms_last_admin_path=%2Fsite%2Fsite-1");
    expect(setCookie).toContain("next-auth.session-token=;");
    expect(setCookie).toContain("authjs.session-token=;");
  });

  it("fails closed when setup cannot resolve a main site after bootstrap", async () => {
    mocks.listSiteIdsForUser.mockResolvedValue([]);
    mocks.siteFindMany.mockResolvedValue([]);

    const response = await POST(
      new Request("http://localhost/api/setup/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            POSTGRES_URL: "postgres://example",
            CMS_DB_PREFIX: "robertbetan_",
          },
          adminName: "Admin User",
          adminEmail: "admin@example.com",
          adminPhone: "",
          adminPassword: "password123",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(mocks.ensureMainSiteForUser).toHaveBeenCalledTimes(2);
    expect(mocks.advanceSetupLifecycleTo).not.toHaveBeenCalledWith("ready");

    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("no main site could be resolved");
  });

  it("marks the schema current when setup only needs a version record after bootstrap", async () => {
    mocks.getDatabaseHealthReport.mockResolvedValue({
      migrationRequired: true,
      pending: [{ id: "2026.03.08.0-version" }],
      missingTables: [],
      disallowedFound: [],
      obsoleteRegistryFound: [],
    });

    const response = await POST(
      new Request("http://localhost/api/setup/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            POSTGRES_URL: "postgres://example",
            POSTGRES_URL_NON_POOLING: "postgres://example-direct",
            CMS_DB_PREFIX: "robertbetan_",
          },
          adminName: "Admin User",
          adminEmail: "admin@example.com",
          adminPhone: "",
          adminPassword: "password123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.markDatabaseSchemaCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.applyPendingDatabaseMigrations).not.toHaveBeenCalled();
  });

  it("returns a clear 409 when managed runtime env values must be configured externally", async () => {
    mocks.saveSetupEnvValues.mockRejectedValue(
      new mocks.SetupEnvPersistenceError(
        "Managed runtime detected. Configure environment values outside the app before continuing.",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/setup/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            POSTGRES_URL: "postgres://example",
            CMS_DB_PREFIX: "robertbetan_",
          },
          adminName: "Admin User",
          adminEmail: "admin@example.com",
          adminPhone: "",
          adminPassword: "password123",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.advanceSetupLifecycleTo).not.toHaveBeenCalled();

    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.envConfigured).toBe(false);
    expect(json.envSaved).toBe(false);
    expect(json.requiresExternalEnvSync).toBe(true);
    expect(json.error).toContain("Configure environment values outside the app");
  });
});
