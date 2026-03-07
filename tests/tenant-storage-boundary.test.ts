import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

function projectPath(...segments: string[]) {
  return path.join(process.cwd(), ...segments);
}

describe("tenant storage boundary contract", () => {
  it("does not allow new shared site_* feature tables in schema definitions", () => {
    const schemaSource = read(projectPath("lib", "schema.ts"));
    const matches = Array.from(schemaSource.matchAll(/tableName\("([^"]+)"\)/g));
    const tableSuffixes = matches.map((entry) => entry[1]).filter((name) => name.startsWith("site_"));

    // Shared network-level tables are allowed.
    const networkSharedAllowlist = new Set<string>([
      "site_communication_attempts",
      "site_communication_messages",
      "site_webcallback_events",
      "site_webhook_deliveries",
      "site_webhook_subscriptions",
    ]);

    // Transitional shared tables that must be removed as per-site physical cutover completes.
    // Keep this explicit so any newly added shared table fails this test.
    const transitionalSharedAllowlist = new Set<string>([
      "site_data_domains",
      "site_domain_post_meta",
      "site_domain_posts",
      "site_examples",
      "site_media",
      "site_menu_item_meta",
      "site_menu_items",
      "site_menus",
      "site_posts",
      "site_term_relationships",
      "site_term_taxonomies",
      "site_term_taxonomy_domains",
      "site_term_taxonomy_meta",
      "site_terms",
    ]);

    const unknownShared = tableSuffixes.filter(
      (suffix) => !networkSharedAllowlist.has(suffix) && !transitionalSharedAllowlist.has(suffix),
    );

    expect(unknownShared).toEqual([]);
  });

  it("site-physical table helpers do not include siteId columns in per-site DDL", () => {
    const siteHelpers = [
      projectPath("lib", "site-settings-tables.ts"),
      projectPath("lib", "site-user-tables.ts"),
      projectPath("lib", "site-comment-tables.ts"),
    ];

    for (const helperPath of siteHelpers) {
      const source = read(helperPath);
      const createTableBlocks = Array.from(
        source.matchAll(/CREATE TABLE IF NOT EXISTS[\s\S]*?\)/g),
      ).map((match) => match[0]);

      for (const ddl of createTableBlocks) {
        expect(ddl).not.toMatch(/"siteId"\s/i);
      }
    }
  });

  it("site-physical table names are keyed by site identity token, not shared table names", () => {
    const userTablesSource = read(projectPath("lib", "site-user-tables.ts"));
    const settingsTablesSource = read(projectPath("lib", "site-settings-tables.ts"));
    const commentTablesSource = read(projectPath("lib", "site-comment-tables.ts"));
    const tableNameHelperSource = read(projectPath("lib", "site-physical-table-name.ts"));

    expect(userTablesSource).toContain('return sitePhysicalTableName(normalizedPrefix, siteId, "users");');
    expect(userTablesSource).toContain('return sitePhysicalTableName(normalizedPrefix, siteId, "user_meta");');
    expect(settingsTablesSource).toContain('return sitePhysicalTableName(normalizedPrefix, siteId, "settings");');
    expect(commentTablesSource).toContain('return sitePhysicalTableName(normalizedPrefix, siteId, "comments");');
    expect(commentTablesSource).toContain('return sitePhysicalTableName(normalizedPrefix, siteId, "comment_meta");');
    expect(tableNameHelperSource).toContain("PG_IDENTIFIER_MAX_LENGTH = 63");
    expect(tableNameHelperSource).toContain("function stableHash");
  });
});
