import db from "@/lib/db";
import { sql } from "drizzle-orm";
import { trace } from "@/lib/debug";

type RequiredColumn = {
  tableSuffix: "posts" | "domain_posts";
  column: "image" | "imageBlurhash";
};

export type MissingDbColumn = {
  table: string;
  column: string;
};

const REQUIRED_COLUMNS: RequiredColumn[] = [
  { tableSuffix: "posts", column: "image" },
  { tableSuffix: "posts", column: "imageBlurhash" },
  { tableSuffix: "domain_posts", column: "image" },
  { tableSuffix: "domain_posts", column: "imageBlurhash" },
];

function getPrefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function toTableName(suffix: RequiredColumn["tableSuffix"]) {
  return `${getPrefix()}${suffix}`;
}

export async function getDatabaseHealthReport() {
  const tableNames = Array.from(new Set(REQUIRED_COLUMNS.map((entry) => toTableName(entry.tableSuffix))));
  const tableNameSql = sql.join(tableNames.map((name) => sql`${name}`), sql`,`);

  const result = await db.execute<{
    table_name: string;
    column_name: string;
  }>(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (${tableNameSql})
  `);

  const rows = (result as any)?.rows ?? [];
  const existing = new Set(rows.map((row: any) => `${String(row.table_name)}.${String(row.column_name)}`));

  const missing: MissingDbColumn[] = REQUIRED_COLUMNS.flatMap((entry) => {
    const table = toTableName(entry.tableSuffix);
    return existing.has(`${table}.${entry.column}`) ? [] : [{ table, column: entry.column }];
  });

  if (missing.length > 0) {
    trace("db", "database update required", { missingColumns: missing });
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

function quoteIdentifier(input: string) {
  return `"${input.replace(/"/g, "\"\"")}"`;
}

export async function applyDatabaseCompatibilityFixes() {
  const postsTable = toTableName("posts");
  const domainPostsTable = toTableName("domain_posts");

  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(postsTable)} ADD COLUMN IF NOT EXISTS "image" text DEFAULT ''`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(postsTable)} ADD COLUMN IF NOT EXISTS "imageBlurhash" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(domainPostsTable)} ADD COLUMN IF NOT EXISTS "image" text DEFAULT ''`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(domainPostsTable)} ADD COLUMN IF NOT EXISTS "imageBlurhash" text`,
    ),
  );

  trace("db", "database compatibility fixes applied", {
    tables: [postsTable, domainPostsTable],
  });
}
