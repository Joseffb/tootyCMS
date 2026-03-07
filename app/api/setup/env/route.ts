import { NextResponse } from "next/server";
import { getInstallState } from "@/lib/install-state";
import { saveSetupEnvValues } from "@/lib/setup-env";
import db from "@/lib/db";
import { sites, users } from "@/lib/schema";
import { trace } from "@/lib/debug";
import { eq, inArray, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/password";
import { NETWORK_ADMIN_ROLE } from "@/lib/rbac";
import { advanceSetupLifecycleTo } from "@/lib/setup-lifecycle";
import { ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import { ensureMainSiteForUser } from "@/lib/bootstrap";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { setSettingByKey } from "@/lib/settings-store";
import { sitePluginEnabledKey } from "@/lib/plugins";
import { getPluginById } from "@/lib/plugins";
import { getAvailableThemes, setSiteTheme, setThemeEnabled } from "@/lib/themes";
import { getSetupDefaultPluginIds, getSetupDefaultThemeId } from "@/lib/setup-defaults";
import {
  applyDatabaseCompatibilityFixes,
  applyPendingDatabaseMigrations,
  getDatabaseHealthReport,
  markDatabaseSchemaCurrent,
} from "@/lib/db-health";
import {
  ALL_EXPECTED_SETUP_TABLE_SUFFIXES,
  OPTIONAL_LEGACY_SETUP_TABLE_SUFFIXES,
  REQUIRED_SETUP_TABLE_SUFFIXES,
} from "@/lib/setup-schema";

const AUTH_SESSION_COOKIE_NAMES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;

const LAST_SITE_COOKIE_NAMES = [
  "cms_last_site_id",
  "tooty_last_site_id",
] as const;

const LAST_ADMIN_PATH_COOKIE_NAMES = [
  "cms_last_admin_path",
  "tooty_last_app_path",
] as const;

async function runLocalDbInit() {
  trace("setup", "db init via local compatibility started");
  await applyDatabaseCompatibilityFixes();
  trace("setup", "db init via local compatibility completed");
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
  if (backend === "command") return runLocalDbInit();
  if (backend === "local") return runLocalDbInit();
  if (process.env.SETUP_DB_INIT_URL?.trim()) return runHttpDbInit(values);
  return runLocalDbInit();
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
  for (const suffix of ALL_EXPECTED_SETUP_TABLE_SUFFIXES) {
    const fullName = `${prefix}${suffix}`;
    const exists = await tableExists(fullName);
    if (!exists) missing.push(fullName);
  }
  const requiredSet = new Set(REQUIRED_SETUP_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`));
  const optionalSet = new Set(OPTIONAL_LEGACY_SETUP_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`));

  const missingRequired = missing.filter((tableName) => requiredSet.has(tableName));
  const missingOptional = missing.filter((tableName) => optionalSet.has(tableName));
  return { missingRequired, missingOptional };
}

function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: false,
  });
}

function applyPostSetupCookies(response: NextResponse, mainSiteId: string | null) {
  for (const name of AUTH_SESSION_COOKIE_NAMES) {
    clearCookie(response, name);
  }
  for (const name of LAST_SITE_COOKIE_NAMES) {
    clearCookie(response, name);
  }
  for (const name of LAST_ADMIN_PATH_COOKIE_NAMES) {
    clearCookie(response, name);
  }

  const normalizedMainSiteId = String(mainSiteId || "").trim();
  if (!normalizedMainSiteId) return;

  response.cookies.set("cms_last_site_id", normalizedMainSiteId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: false,
  });
  response.cookies.set("cms_last_admin_path", `/site/${normalizedMainSiteId}`, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: false,
  });
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
          "Environment was saved, but required DB schema could not be initialized automatically. Fix the DB bootstrap issue, then click Finish Setup again.",
      },
      { status: 409 },
    );
  }

  await advanceSetupLifecycleTo("configured");

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
  let ensuredUserId = "";
  if (!existingUser) {
    const created = await db
      .insert(users)
      .values({
        email: adminEmail,
        name: adminName,
        role: NETWORK_ADMIN_ROLE,
        authProvider: "native",
        passwordHash,
      })
      .returning({ id: users.id });
    ensuredUserId = String(created[0]?.id || "").trim();
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
    ensuredUserId = String(existingUser.id || "").trim();
  }
  if (!ensuredUserId) {
    throw new Error("Failed to create or resolve setup admin user.");
  }
  await setSettingByKey("bootstrap_admin_name", adminName);
  await setSettingByKey("bootstrap_admin_email", adminEmail);
  await setSettingByKey("bootstrap_admin_phone", adminPhone);
  await setSettingByKey("setup_completed", "true");
  await setSettingByKey("setup_completed_at", new Date().toISOString());
  const inferredSiteUrl = inferSiteUrl(normalized);
  if (inferredSiteUrl) {
    await setSettingByKey("site_url", inferredSiteUrl);
  }

  const setupPluginIds = getSetupDefaultPluginIds(process.env.SETUP_DEFAULT_ENABLED_PLUGINS);
  for (const pluginId of setupPluginIds) {
    const plugin = await getPluginById(pluginId);
    if (!plugin) continue;
    await setSettingByKey(`plugin_${pluginId}_enabled`, "true");
  }

  await ensureDefaultCoreDataDomains();
  await ensureMainSiteForUser(ensuredUserId, { seedStarterContent: true });
  let siteIds = await listSiteIdsForUser(ensuredUserId);
  let memberSites = siteIds.length > 0
    ? await db.query.sites.findMany({
        where: inArray(sites.id, siteIds),
        columns: { id: true, isPrimary: true, subdomain: true },
      })
    : [];
  let mainSiteId =
    memberSites.find((site) => site.isPrimary || site.subdomain === "main")?.id ||
    memberSites[0]?.id ||
    null;

  if (!mainSiteId) {
    trace("setup", "main site missing after initial bootstrap; retrying site ensure", {
      adminEmail,
      userId: ensuredUserId,
    });
    await ensureMainSiteForUser(ensuredUserId, { seedStarterContent: true });
    siteIds = await listSiteIdsForUser(ensuredUserId);
    memberSites = siteIds.length > 0
      ? await db.query.sites.findMany({
          where: inArray(sites.id, siteIds),
          columns: { id: true, isPrimary: true, subdomain: true },
        })
      : [];
    mainSiteId =
      memberSites.find((site) => site.isPrimary || site.subdomain === "main")?.id ||
      memberSites[0]?.id ||
      null;
  }

  if (!mainSiteId) {
    trace("setup", "setup save invariant failed: main site unresolved after bootstrap", {
      adminEmail,
      userId: ensuredUserId,
    });
    return NextResponse.json(
      {
        ok: false,
        envSaved: true,
        dbInitialized: true,
        userCreated: true,
        error:
          "Setup created the admin user, but no main site could be resolved. Repair site bootstrap and run setup again.",
      },
      { status: 500 },
    );
  }

  if (mainSiteId) {
    for (const pluginId of setupPluginIds) {
      const plugin = await getPluginById(pluginId);
      if (!plugin || plugin.scope !== "site") continue;
      await setSettingByKey(sitePluginEnabledKey(mainSiteId, pluginId), "true");
    }

    const defaultThemeId = getSetupDefaultThemeId(process.env.SETUP_DEFAULT_THEME_ID);
    if (defaultThemeId) {
      const availableThemes = await getAvailableThemes();
      const matchingTheme = availableThemes.find((theme) => theme.id === defaultThemeId);
      if (matchingTheme) {
        await setThemeEnabled(defaultThemeId, true);
        await setSiteTheme(mainSiteId, defaultThemeId);
      }
    }
  }

  await advanceSetupLifecycleTo("ready");
  trace("setup", "setup save completed successfully");
  const response = NextResponse.json({
    ok: true,
    envSaved: true,
    dbInitialized: true,
    userCreated: true,
    mainSiteId,
  });
  applyPostSetupCookies(response, mainSiteId);
  return response;
}
