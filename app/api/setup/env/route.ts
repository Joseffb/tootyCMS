import { NextResponse } from "next/server";
import { getInstallState } from "@/lib/install-state";
import { saveSetupEnvValues } from "@/lib/setup-env";
import db from "@/lib/db";
import { cmsSettings, users } from "@/lib/schema";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { trace } from "@/lib/debug";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/password";
import { NETWORK_ADMIN_ROLE } from "@/lib/rbac";
import { advanceSetupLifecycleTo } from "@/lib/setup-lifecycle";
import { ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import {
  applyPendingDatabaseMigrations,
  getDatabaseHealthReport,
  markDatabaseSchemaCurrent,
} from "@/lib/db-health";

const execFileAsync = promisify(execFile);

async function runCommandDbInit(values: Record<string, string>) {
  trace("setup", "db init via command started");
  await execFileAsync(
    "npx",
    ["drizzle-kit", "push", "--config", "drizzle.config.ts"],
    {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...values,
      CI: "1",
      NO_COLOR: "1",
    },
    timeout: 30_000,
    },
  );
  trace("setup", "db init via command completed");
}

async function runHttpDbInit(values: Record<string, string>) {
  const endpoint = process.env.SETUP_DB_INIT_URL?.trim();
  if (!endpoint) throw new Error("SETUP_DB_INIT_URL is missing.");
  const token = process.env.SETUP_DB_INIT_TOKEN?.trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ values }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Remote DB init failed (${response.status}).`);
  }
  trace("setup", "db init via http completed", { endpoint });
}

async function initializeDbSchema(values: Record<string, string>) {
  const backend = (process.env.SETUP_DB_INIT_BACKEND || "auto").trim().toLowerCase();
  trace("setup", "db init backend selected", { backend });
  if (backend === "none") return;
  if (backend === "http") return runHttpDbInit(values);
  if (backend === "command") return runCommandDbInit(values);
  if (process.env.SETUP_DB_INIT_URL?.trim()) return runHttpDbInit(values);
  return runCommandDbInit(values);
}

function normalizedPrefixFromValues(values: Record<string, string>) {
  const raw = (values.CMS_DB_PREFIX || process.env.CMS_DB_PREFIX || "tooty_").trim();
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function inferSiteUrl(values: Record<string, string>) {
  const configured = (values.NEXT_PUBLIC_ROOT_DOMAIN || process.env.NEXT_PUBLIC_ROOT_DOMAIN || "").trim();
  if (configured) {
    const nextAuthUrl = (values.NEXTAUTH_URL || process.env.NEXTAUTH_URL || "").trim();
    const protocol = nextAuthUrl.startsWith("https://") ? "https" : "http";
    const rootHost = configured.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    try {
      const parsed = new URL(nextAuthUrl);
      const port = parsed.port ? `:${parsed.port}` : "";
      return `${protocol}://${rootHost}${port}`;
    } catch {
      return `${protocol}://${rootHost}`;
    }
  }
  return "";
}

const REQUIRED_TABLE_SUFFIXES = [
  "communication_attempts",
  "communication_messages",
  "cms_settings",
  "data_domains",
  "domain_post_meta",
  "domain_posts",
  "media",
  "rbac_roles",
  "sessions",
  "site_data_domains",
  "sites",
  "site_user_table_registry",
  "term_relationships",
  "term_taxonomies",
  "term_taxonomy_domains",
  "terms",
  "users",
  "user_meta",
  "verificationTokens",
  "accounts",
  "webcallback_events",
  "webhook_subscriptions",
  "webhook_deliveries",
] as const;

const OPTIONAL_LEGACY_TABLE_SUFFIXES = [
  "categories",
  "examples",
  "post_categories",
  "post_meta",
  "post_tags",
  "posts",
  "tags",
] as const;

const ALL_EXPECTED_TABLE_SUFFIXES = [
  "accounts",
  "categories",
  "communication_attempts",
  "communication_messages",
  "cms_settings",
  "data_domains",
  "domain_post_meta",
  "domain_posts",
  "examples",
  "media",
  "post_categories",
  "post_meta",
  "post_tags",
  "posts",
  "rbac_roles",
  "sessions",
  "site_data_domains",
  "sites",
  "site_user_table_registry",
  "tags",
  "term_relationships",
  "term_taxonomies",
  "term_taxonomy_domains",
  "terms",
  "users",
  "user_meta",
  "verificationTokens",
  "webcallback_events",
  "webhook_subscriptions",
  "webhook_deliveries",
] as const;

const DEFAULT_ENABLED_PLUGINS = ["hello-teety"] as const;

async function tableExists(tableName: string) {
  const result = (await db.execute(
    sql`select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = ${tableName}
    ) as "exists"`,
  )) as { rows?: Array<{ exists?: boolean | string | number | null }> };
  const existsValue = result.rows?.[0]?.exists;
  return existsValue === true || existsValue === "t" || existsValue === "true" || existsValue === 1;
}

async function getMissingTableSets(values: Record<string, string>) {
  const prefix = normalizedPrefixFromValues(values);
  const missing: string[] = [];
  for (const suffix of ALL_EXPECTED_TABLE_SUFFIXES) {
    const fullName = `${prefix}${suffix}`;
    const exists = await tableExists(fullName);
    if (!exists) missing.push(fullName);
  }
  const requiredSet = new Set(REQUIRED_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`));
  const optionalSet = new Set(OPTIONAL_LEGACY_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`));

  const missingRequired = missing.filter((tableName) => requiredSet.has(tableName));
  const missingOptional = missing.filter((tableName) => optionalSet.has(tableName));
  return { missingRequired, missingOptional };
}

export async function POST(req: Request) {
  trace("setup", "setup save request received");
  const state = await getInstallState();
  if (!state.setupRequired) {
    trace("setup", "setup save rejected: already complete");
    return NextResponse.json({ error: "Setup is already complete." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    trace("setup", "setup save rejected: invalid json");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const values = (payload ? payload.values : null) as
    | Record<string, unknown>
    | null;
  const adminName = typeof payload?.adminName === "string" ? payload.adminName.trim() : "";
  const adminEmail = typeof payload?.adminEmail === "string" ? payload.adminEmail.trim().toLowerCase() : "";
  const adminPhone = typeof payload?.adminPhone === "string" ? payload.adminPhone.trim() : "";
  const adminPassword = typeof payload?.adminPassword === "string" ? payload.adminPassword : "";
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail);

  if (!values || typeof values !== "object") {
    trace("setup", "setup save rejected: missing values payload");
    return NextResponse.json({ error: "Missing values payload." }, { status: 400 });
  }
  if (!adminEmail) {
    trace("setup", "setup save rejected: missing admin email");
    return NextResponse.json({ error: "Admin email is required." }, { status: 400 });
  }
  if (!emailLooksValid) {
    trace("setup", "setup save rejected: invalid admin email");
    return NextResponse.json({ error: "Admin email must be a valid email address." }, { status: 400 });
  }
  if (!adminName) {
    trace("setup", "setup save rejected: missing admin name");
    return NextResponse.json({ error: "Admin name is required." }, { status: 400 });
  }
  if (!adminPassword || adminPassword.length < 8) {
    trace("setup", "setup save rejected: weak admin password");
    return NextResponse.json({ error: "Admin password must be at least 8 characters." }, { status: 400 });
  }

  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value ?? "")]),
  );
  trace("setup", "saving setup env values");
  await saveSetupEnvValues(normalized);
  await advanceSetupLifecycleTo("configured");
  try {
    const missingTables = await getMissingTableSets(normalized);
    trace("setup", "required table existence check", {
      missingRequiredCount: missingTables.missingRequired.length,
      missingOptionalCount: missingTables.missingOptional.length,
    });
    if (missingTables.missingRequired.length > 0) {
      trace("setup", "initializing db schema");
      await initializeDbSchema(normalized);
    } else {
      trace("setup", "db init skipped because all required tables exist");
    }
  } catch {
    trace("setup", "db schema init failed; continuing to relation probe");
    // Continue to DB probe below; if schema is still missing we return a clear error.
  }

  const missingAfterInit = await getMissingTableSets(normalized);
  if (missingAfterInit.missingRequired.length > 0) {
    trace("setup", "setup save incomplete: missing tables after init", {
      missingRequiredCount: missingAfterInit.missingRequired.length,
      missingOptionalCount: missingAfterInit.missingOptional.length,
    });
    return NextResponse.json(
      {
        ok: false,
        envSaved: true,
        requiresDbInit: true,
        error:
          "Environment was saved, but required DB schema could not be initialized automatically. Run `npx drizzle-kit push` once, then click Finish Setup again.",
      },
      { status: 409 },
    );
  }

  const dbHealth = await getDatabaseHealthReport();
  if (dbHealth.migrationRequired) {
    trace("setup", "applying pending database migrations during setup", {
      pendingCount: dbHealth.pending.length,
    });
    await applyPendingDatabaseMigrations();
  } else {
    await markDatabaseSchemaCurrent();
  }
  await advanceSetupLifecycleTo("migrated");

  trace("setup", "storing setup metadata and creating native admin user", {
    adminEmail,
  });
  const passwordHash = await hashPassword(adminPassword);
  const existingUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.email, adminEmail),
    columns: { id: true },
  });
  if (!existingUser) {
    await db.insert(users).values({
      email: adminEmail,
      name: adminName,
      role: NETWORK_ADMIN_ROLE,
      authProvider: "native",
      passwordHash,
    });
  } else {
    await db
      .update(users)
      .set({
        name: adminName,
        role: NETWORK_ADMIN_ROLE,
        authProvider: "native",
        passwordHash,
      })
      .where(eq(users.id, existingUser.id));
  }
  await db
    .insert(cmsSettings)
    .values({ key: "bootstrap_admin_name", value: adminName })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: adminName, updatedAt: new Date() },
    });
  await db
    .insert(cmsSettings)
    .values({ key: "bootstrap_admin_email", value: adminEmail })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: adminEmail, updatedAt: new Date() },
    });
  await db
    .insert(cmsSettings)
    .values({ key: "bootstrap_admin_phone", value: adminPhone })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: adminPhone, updatedAt: new Date() },
    });
  await db
    .insert(cmsSettings)
    .values({ key: "setup_completed", value: "true" })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: "true", updatedAt: new Date() },
    });
  await db
    .insert(cmsSettings)
    .values({ key: "setup_completed_at", value: new Date().toISOString() })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: new Date().toISOString(), updatedAt: new Date() },
    });
  const inferredSiteUrl = inferSiteUrl(normalized);
  if (inferredSiteUrl) {
    await db
      .insert(cmsSettings)
      .values({ key: "site_url", value: inferredSiteUrl })
      .onConflictDoNothing();
  }

  for (const pluginId of DEFAULT_ENABLED_PLUGINS) {
    await db
      .insert(cmsSettings)
      .values({ key: `plugin_${pluginId}_enabled`, value: "true" })
      .onConflictDoNothing();
  }

  await ensureDefaultCoreDataDomains();

  await advanceSetupLifecycleTo("ready");
  trace("setup", "setup save completed successfully");
  return NextResponse.json({ ok: true, envSaved: true, dbInitialized: true, userCreated: true });
}
