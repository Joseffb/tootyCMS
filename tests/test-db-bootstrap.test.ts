import { describe, expect, it } from "vitest";

import {
  TARGET_DB_SCHEMA_VERSION,
  applyPendingDatabaseMigrations,
  getDatabaseHealthReport,
} from "@/lib/db-health";

const hasConfiguredDb = Boolean(
  String(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL || "").trim(),
);

describe("test db bootstrap", () => {
  const bootstrapTest = hasConfiguredDb ? it : it.skip;

  bootstrapTest(
    "applies deterministic core migrations without interactive prompts",
    async () => {
      await applyPendingDatabaseMigrations();
      const report = await getDatabaseHealthReport();

      expect(report.ok).toBe(true);
      expect(report.migrationRequired).toBe(false);
      expect(report.targetVersion).toBe(TARGET_DB_SCHEMA_VERSION);
      expect(report.currentVersion).toBe(TARGET_DB_SCHEMA_VERSION);
    },
    60_000,
  );
});
