import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest, listPluginsWithSiteState, listPluginsWithState } from "@/lib/plugin-runtime";
import db from "@/lib/db";
import { dataDomains, domainPosts, media, users } from "@/lib/schema";
import { sendCommunication } from "@/lib/communications";
import { listSiteUsers } from "@/lib/site-user-tables";
import { NETWORK_ADMIN_ROLE } from "@/lib/rbac";
import { eq, inArray, sql } from "drizzle-orm";
import { trace } from "@/lib/debug";
import { getUserMetaValue, setUserMetaValue } from "@/lib/user-meta";

type ActionName =
  | "providers"
  | "export"
  | "export.inspect"
  | "export.status"
  | "export.cancel"
  | "import.inspect"
  | "import.apply";

type Body = {
  action?: ActionName;
  siteId?: string | null;
  format?: string | null;
  exportReason?: string | null;
  deliveryEmail?: string | null;
  verificationCode?: string | null;
  options?: Record<string, unknown> | null;
  payload?: unknown;
  payloadBase64?: string | null;
  payloadEncoding?: string | null;
  payloadMimeType?: string | null;
  payloadUrl?: string | null;
};

function toSafeString(value: unknown) {
  return String(value || "").trim();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toStringList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function toEstimatedBand(count: number) {
  if (!Number.isFinite(count) || count <= 0) return "none";
  if (count <= 5) return "very-low";
  if (count <= 25) return "low";
  if (count <= 100) return "medium";
  return "high";
}

function toEstimatedSizeBand(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "none";
  if (bytes <= 5 * 1024 * 1024) return "very-low";
  if (bytes <= 50 * 1024 * 1024) return "low";
  if (bytes <= 500 * 1024 * 1024) return "medium";
  return "high";
}

function isSnapshotFormat(format: string) {
  return String(format || "").toLowerCase().includes("snapshot");
}

function isArticlesFormat(format: string) {
  return String(format || "").toLowerCase().includes("article");
}

function normalizeExportOptionsForFormat(format: string, rawOptions: Record<string, unknown>) {
  const options = { ...rawOptions };
  if (isSnapshotFormat(format)) {
    // Snapshot is governance-defined as a full site capture.
    options.includeDomains = true;
    options.includeEntries = true;
    options.snapshotScope = "entire-site";
  }
  return options;
}

async function estimateDryRunBands(input: {
  siteId: string;
  format: string;
  options: Record<string, unknown> | null;
}) {
  const snapshotMode = isSnapshotFormat(input.format);
  const selectedDomains = toStringList(input.options?.domains);
  const domainRows = await db.select({ id: dataDomains.id, key: dataDomains.key }).from(dataDomains);
  const selectedDomainIds =
    selectedDomains.length > 0
      ? domainRows.filter((row) => selectedDomains.includes(String(row.key || ""))).map((row) => row.id)
      : [];
  const allDomainCount = domainRows.length;

  let articleCount = 0;
  const includeUsersMode = String(input.options?.includeUsers || "site-users");
  const includeMediaMode = String(input.options?.includeMedia || "references");
  const includeEntries = snapshotMode ? input.options?.includeEntries !== false : true;
  if (!includeEntries) {
    let userCount = 0;
    if (includeUsersMode === "all-users" || (!input.siteId && includeUsersMode === "site-users")) {
      const rows = await db.execute(sql`SELECT count(*)::int AS total FROM ${users}`);
      userCount = Number((rows as any)?.rows?.[0]?.total ?? 0);
    } else if (includeUsersMode === "site-users" && input.siteId) {
      const siteUsers = await listSiteUsers(input.siteId);
      userCount = siteUsers.length;
    }
    let mediaCount = 0;
    let mediaBytes = 0;
    if (includeMediaMode !== "none") {
      const mediaWhere = input.siteId ? sql`WHERE "siteId" = ${input.siteId}` : sql``;
      const mediaRows = await db.execute(sql`
        SELECT count(*)::int AS total, COALESCE(sum(CASE WHEN "size" IS NULL THEN 0 ELSE "size" END), 0)::bigint AS bytes
        FROM ${media}
        ${mediaWhere}
      `);
      mediaCount = Number((mediaRows as any)?.rows?.[0]?.total ?? 0);
      mediaBytes = Number((mediaRows as any)?.rows?.[0]?.bytes ?? 0);
    }
    return {
      selectedDomains,
      selectedDomainCountBand: snapshotMode
        ? input.options?.includeDomains === false
          ? "none"
          : toEstimatedBand(domainRows.length)
        : toEstimatedBand(selectedDomains.length || domainRows.length),
      availableDomainsBand: toEstimatedBand(domainRows.length),
      articlesBand: "none",
      usersBand: includeUsersMode === "none" ? "none" : toEstimatedBand(userCount),
      mediaItemsBand: includeMediaMode === "none" ? "none" : toEstimatedBand(mediaCount),
      mediaSizeBand:
        includeMediaMode === "with-binaries"
          ? toEstimatedSizeBand(mediaBytes)
          : includeMediaMode === "with-manifest"
            ? toEstimatedBand(mediaCount)
            : "minimal",
    };
  }

  if (selectedDomainIds.length > 0) {
    if (input.siteId) {
      const rows = await db.execute(sql`
        SELECT count(*)::int AS total
        FROM ${domainPosts}
        WHERE "siteId" = ${input.siteId}
          AND "dataDomainId" IN (${sql.join(selectedDomainIds.map((id) => sql`${id}`), sql`,`)})
      `);
      articleCount = Number((rows as any)?.rows?.[0]?.total ?? 0);
    } else {
      const rows = await db.execute(sql`
        SELECT count(*)::int AS total
        FROM ${domainPosts}
        WHERE "dataDomainId" IN (${sql.join(selectedDomainIds.map((id) => sql`${id}`), sql`,`)})
      `);
      articleCount = Number((rows as any)?.rows?.[0]?.total ?? 0);
    }
  } else if (input.siteId) {
    const rows = await db.execute(sql`
      SELECT count(*)::int AS total
      FROM ${domainPosts}
      WHERE "siteId" = ${input.siteId}
    `);
    articleCount = Number((rows as any)?.rows?.[0]?.total ?? 0);
  } else {
    const rows = await db.execute(sql`SELECT count(*)::int AS total FROM ${domainPosts}`);
    articleCount = Number((rows as any)?.rows?.[0]?.total ?? 0);
  }

  let userCount = 0;
  if (includeUsersMode === "all-users" || (!input.siteId && includeUsersMode === "site-users")) {
    const rows = await db.execute(sql`SELECT count(*)::int AS total FROM ${users}`);
    userCount = Number((rows as any)?.rows?.[0]?.total ?? 0);
  } else if (includeUsersMode === "site-users" && input.siteId) {
    const siteUsers = await listSiteUsers(input.siteId);
    userCount = siteUsers.length;
  }
  let mediaCount = 0;
  let mediaBytes = 0;
  if (includeMediaMode !== "none") {
    const mediaWhere = input.siteId ? sql`WHERE "siteId" = ${input.siteId}` : sql``;
    const mediaRows = await db.execute(sql`
      SELECT count(*)::int AS total, COALESCE(sum(CASE WHEN "size" IS NULL THEN 0 ELSE "size" END), 0)::bigint AS bytes
      FROM ${media}
      ${mediaWhere}
    `);
    mediaCount = Number((mediaRows as any)?.rows?.[0]?.total ?? 0);
    mediaBytes = Number((mediaRows as any)?.rows?.[0]?.bytes ?? 0);
  }

  return {
    selectedDomains,
    selectedDomainCountBand: snapshotMode
      ? input.options?.includeDomains === false
        ? "none"
        : toEstimatedBand(allDomainCount)
      : toEstimatedBand(selectedDomains.length || allDomainCount),
    availableDomainsBand: toEstimatedBand(allDomainCount),
    articlesBand: toEstimatedBand(articleCount),
    usersBand: includeUsersMode === "none" ? "none" : toEstimatedBand(userCount),
    mediaItemsBand: includeMediaMode === "none" ? "none" : toEstimatedBand(mediaCount),
    mediaSizeBand:
      includeMediaMode === "with-binaries"
        ? toEstimatedSizeBand(mediaBytes)
        : includeMediaMode === "with-manifest"
          ? toEstimatedBand(mediaCount)
          : "minimal",
  };
}

function buildRedactedExportInspectResult(input: {
  source: Record<string, unknown>;
  siteId: string;
  format: string;
  exportReason: string;
  estimates?: {
    selectedDomains: string[];
    selectedDomainCountBand: string;
    availableDomainsBand: string;
    articlesBand: string;
    usersBand: string;
    mediaItemsBand: string;
    mediaSizeBand: string;
  };
}) {
  const source = input.source;
  const payload = toRecord(source.payload);
  const options = toRecord(source.options);
  const provider = toRecord(source.provider);
  const snapshotMode = isSnapshotFormat(input.format);
  const articlesMode = isArticlesFormat(input.format);

  const includeDomains = input.estimates?.selectedDomains || toStringList(payload?.includeDomains || options?.domains);
  const availableDomains = Array.isArray(payload?.availableDomains) ? payload?.availableDomains.length : 0;
  const articlesCount = Array.isArray(payload?.articles) ? payload?.articles.length : 0;

  return {
    ok: source.ok === true,
    mode: "dry-run",
    redacted: true,
    format: input.format,
    siteId: input.siteId || "",
    generatedAt: String(source.generatedAt || new Date().toISOString()),
    report: {
      scope: snapshotMode ? (input.siteId ? "site-entire" : "network-entire") : input.siteId ? "site" : "network",
      reasonProvided: input.exportReason.length >= 8,
      selectedDomainCountBand: input.estimates?.selectedDomainCountBand || toEstimatedBand(includeDomains.length),
      selectedDomains: includeDomains,
      estimatedVolumes: {
        availableDomainsBand: input.estimates?.availableDomainsBand || toEstimatedBand(availableDomains),
        articlesBand: input.estimates?.articlesBand || toEstimatedBand(articlesCount),
        usersBand: input.estimates?.usersBand || "unknown",
        mediaItemsBand: input.estimates?.mediaItemsBand || "unknown",
        mediaSizeBand: input.estimates?.mediaSizeBand || "unknown",
      },
      formatFamily: snapshotMode ? "snapshot" : articlesMode ? "articles" : "generic",
      includes: snapshotMode
        ? {
            entries: options?.includeEntries !== false,
            domains: options?.includeDomains !== false,
            settings: options?.includeSettings !== false,
            mediaMode: String(options?.includeMedia || "references"),
            usersMode: String(options?.includeUsers || "site-users"),
          }
        : {
            content: Boolean(options?.includeContent),
            seo: Boolean(options?.includeSeo),
            featuredMedia: Boolean(options?.includeFeaturedMedia),
            mediaManifest: Boolean(options?.includeMediaManifest),
            metaMode: String(options?.includeMeta || "none"),
          },
      notes: [
        ...(snapshotMode ? ["Snapshot exports always cover the entire site scope."] : []),
        "Dry run preview is redacted by design and does not return exportable records.",
        "Volume bands are coarse estimates, not exact counts.",
      ],
    },
    warnings: toStringList(source.warnings),
    provider: provider
      ? {
          id: String(provider.id || ""),
          label: String(provider.label || ""),
          version: String(provider.version || ""),
          source: String(provider.source || ""),
          enabled: provider.enabled !== false,
          capabilities: toRecord(provider.capabilities) || {},
        }
      : undefined,
  };
}

function verificationKey(siteId: string, format: string) {
  return `migration_export_verify_${siteId || "network"}_${format || "unknown"}`.toLowerCase();
}

function issueCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function migrationOpsTableName() {
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalized = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  return `${normalized}migration_operations`;
}

function quotedTable(name: string) {
  return `"${String(name || "").replace(/"/g, "\"\"")}"`;
}

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

function safeSegment(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "file";
}

function exportArtifactsTableName() {
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalized = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  return `${normalized}export_artifacts`;
}

function exportLinkTtlMs() {
  const hoursRaw = Number(process.env.EXPORT_LINK_TTL_HOURS || 48);
  const safeHours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 48;
  return Math.floor(safeHours * 60 * 60 * 1000);
}

function appBaseUrl() {
  const nextAuth = toSafeString(process.env.NEXTAUTH_URL);
  if (nextAuth) return nextAuth.replace(/\/+$/, "");
  const siteUrl = toSafeString(process.env.SITE_URL || process.env.site_url);
  if (siteUrl) return siteUrl.replace(/\/+$/, "");
  return "http://localhost:3000";
}

function parseFilenameFromDisposition(disposition: string, fallback: string) {
  const raw = String(disposition || "");
  const star = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) return decodeURIComponent(star[1]).trim().replace(/^"+|"+$/g, "") || fallback;
  const basic = raw.match(/filename="?([^";]+)"?/i);
  if (basic?.[1]) return basic[1].trim() || fallback;
  return fallback;
}

function extensionFromMime(contentType: string, fallback: string) {
  const lower = String(contentType || "").toLowerCase();
  if (lower.includes("zip")) return "zip";
  if (lower.includes("json")) return "json";
  if (lower.includes("ndjson")) return "ndjson";
  return fallback;
}

async function ensureMigrationOpsTable() {
  const table = quotedTable(migrationOpsTableName());
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      site_id TEXT,
      action TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      error TEXT,
      reason TEXT
    )
  `));
  await db.execute(sql.raw(`
    ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS reason TEXT
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS "${migrationOpsTableName()}_pending_idx"
    ON ${table} (site_id, action, format, status, created_at DESC)
  `));
}

async function ensureExportArtifactsTable() {
  const table = quotedTable(exportArtifactsTableName());
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${table} (
      token TEXT PRIMARY KEY,
      site_id TEXT,
      user_id TEXT NOT NULL,
      format TEXT NOT NULL,
      media_object_key TEXT NOT NULL,
      media_url TEXT NOT NULL,
      mime_type TEXT,
      file_name TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS "${exportArtifactsTableName()}_expires_idx"
    ON ${table} (expires_at)
  `));
}

async function storeExportArtifactInMedia(input: {
  siteId: string;
  userId: string;
  format: string;
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}) {
  const missingAws =
    !process.env.AWS_REGION ||
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY ||
    !process.env.AWS_S3_BUCKET;
  if (missingAws) {
    throw new Error("AWS S3 export storage is not configured.");
  }
  const hash = crypto.createHash("sha256").update(input.bytes).digest("hex");
  const extension = extensionFromMime(input.contentType, input.fileName.split(".").pop() || "bin");
  const scope = safeSegment(input.siteId || "network");
  const key = `exports/${scope}/${safeSegment(input.format)}-${hash}.${extension}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body: Buffer.from(input.bytes),
      ContentType: input.contentType || "application/octet-stream",
    }),
  );
  const url = `s3://${process.env.AWS_S3_BUCKET}/${key}`;
  await db
    .insert(media)
    .values({
      siteId: input.siteId || null,
      userId: input.userId,
      provider: "s3",
      bucket: process.env.AWS_S3_BUCKET!,
      objectKey: key,
      url,
      label: input.fileName,
      mimeType: input.contentType || "application/octet-stream",
      size: input.bytes.byteLength,
    })
    .onConflictDoUpdate({
      target: media.objectKey,
      set: {
        siteId: input.siteId || null,
        userId: input.userId,
        provider: "s3",
        bucket: process.env.AWS_S3_BUCKET!,
        url,
        label: input.fileName,
        mimeType: input.contentType || "application/octet-stream",
        size: input.bytes.byteLength,
        updatedAt: new Date(),
      },
    });
  return { key, url };
}

async function createExportArtifactToken(input: {
  siteId: string;
  userId: string;
  format: string;
  mediaObjectKey: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
}) {
  await ensureExportArtifactsTable();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + exportLinkTtlMs());
  const table = sql.raw(quotedTable(exportArtifactsTableName()));
  await db.execute(sql`
    INSERT INTO ${table}
      (token, site_id, user_id, format, media_object_key, media_url, mime_type, file_name, expires_at, created_at)
    VALUES
      (${token}, ${input.siteId || null}, ${input.userId}, ${input.format}, ${input.mediaObjectKey}, ${input.mediaUrl}, ${input.mimeType || null}, ${input.fileName || null}, ${expiresAt.toISOString()}::timestamptz, NOW())
  `);
  return { token, expiresAt };
}

async function sendExportDeliveryLinkToUser(input: {
  actorUserId: string;
  siteId: string;
  format: string;
  reason: string;
  deliveryEmail: string;
  linkUrl: string;
  expiresAt: Date;
}) {
  if (!input.deliveryEmail) return;
  await sendCommunication(
    {
      siteId: input.siteId || null,
      channel: "email",
      to: input.deliveryEmail,
      subject: "[Tooty] Your export download is ready",
      body:
        `Your export is ready.\n` +
        `Format: ${input.format}\n` +
        `Scope: ${input.siteId ? `site ${input.siteId}` : "network"}\n` +
        `Reason: ${input.reason || "(not provided)"}\n` +
        `Download URL: ${input.linkUrl}\n` +
        `Expires: ${input.expiresAt.toISOString()}\n` +
        `After expiry this link is no longer available.`,
      category: "transactional",
      metadata: {
        kind: "migration_export_delivery",
        siteId: input.siteId || null,
        format: input.format,
        linkUrl: input.linkUrl,
        expiresAt: input.expiresAt.toISOString(),
        reason: input.reason || null,
      },
    },
    { createdByUserId: input.actorUserId },
  );
}

async function findPendingMigrationOperation(input: { siteId: string; action: string; format: string }) {
  await ensureMigrationOpsTable();
  const table = sql.raw(quotedTable(migrationOpsTableName()));
  const siteIdOrNull = input.siteId || null;
  const rows = await db.execute(sql`
    SELECT id, created_at
    FROM ${table}
    WHERE status = 'pending'
      AND action = ${input.action}
      AND format = ${input.format}
      AND (
        (${siteIdOrNull}::text IS NULL AND site_id IS NULL)
        OR site_id = ${siteIdOrNull}::text
      )
      AND created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = (rows as any)?.rows?.[0];
  return row
    ? {
        id: String(row.id),
        createdAt: String(row.created_at),
      }
    : null;
}

async function createPendingMigrationOperation(input: {
  userId: string;
  siteId: string;
  action: string;
  format: string;
  reason?: string;
}) {
  await ensureMigrationOpsTable();
  const id = crypto.randomUUID();
  const table = sql.raw(quotedTable(migrationOpsTableName()));
  await db.execute(sql`
    INSERT INTO ${table} (id, user_id, site_id, action, format, status, created_at, updated_at, reason)
    VALUES (${id}, ${input.userId}, ${input.siteId || null}, ${input.action}, ${input.format}, 'pending', NOW(), NOW(), ${input.reason || null})
  `);
  return id;
}

async function finalizeMigrationOperation(id: string, input: { status: "completed" | "failed"; error?: string }) {
  await ensureMigrationOpsTable();
  const table = sql.raw(quotedTable(migrationOpsTableName()));
  await db.execute(sql`
    UPDATE ${table}
    SET status = ${input.status},
        error = ${input.error || null},
        updated_at = NOW(),
        finished_at = NOW()
    WHERE id = ${id}
  `);
}

async function resolvePayload(body: Body) {
  const directPayload = body.payload;
  if (directPayload !== undefined && directPayload !== null && String(directPayload).trim() !== "") {
    return { payload: directPayload };
  }

  const payloadBase64 = toSafeString(body.payloadBase64);
  if (payloadBase64) {
    return {
      payloadBase64,
      payloadEncoding: toSafeString(body.payloadEncoding) || "base64",
      payloadMimeType: toSafeString(body.payloadMimeType) || "application/octet-stream",
    };
  }

  const payloadUrl = toSafeString(body.payloadUrl);
  if (!payloadUrl) return null;
  if (!/^https?:\/\//i.test(payloadUrl)) {
    throw new Error("Import URL must start with http:// or https://");
  }
  return { payloadUrl };
}

async function isMigrationPluginActive(siteId: string) {
  if (siteId) {
    const plugins = await listPluginsWithSiteState(siteId);
    const migration = plugins.find((plugin) => plugin.id === "export-import");
    return Boolean(migration?.enabled && migration?.siteEnabled);
  }
  const plugins = await listPluginsWithState();
  const migration = plugins.find((plugin) => plugin.id === "export-import");
  return Boolean(migration?.enabled);
}

async function listNetworkAdminEmails() {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.role, NETWORK_ADMIN_ROLE));
  return rows.map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean);
}

async function listSiteAdminEmails(siteId: string) {
  const memberships = await listSiteUsers(siteId);
  const adminUserIds = memberships
    .filter((row) => {
      const role = String(row.role || "").trim().toLowerCase();
      return role === "administrator" || role === NETWORK_ADMIN_ROLE;
    })
    .map((row) => String(row.user_id || "").trim())
    .filter(Boolean);
  if (adminUserIds.length === 0) return [];
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.id, Array.from(new Set(adminUserIds))));
  return rows.map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean);
}

async function notifyMigrationAdmins(input: {
  actorUserId: string;
  siteId: string;
  action: ActionName;
  format: string;
  reason?: string;
}) {
  try {
    const actor = await db.query.users.findFirst({
      where: eq(users.id, input.actorUserId),
      columns: { email: true },
    });
    const actorEmail = String(actor?.email || "").trim() || input.actorUserId;
    const recipients = input.siteId ? await listSiteAdminEmails(input.siteId) : await listNetworkAdminEmails();
    const uniqueRecipients = Array.from(new Set(recipients));
    if (uniqueRecipients.length === 0) return;
    const scopeLabel = input.siteId ? `site ${input.siteId}` : "network";
    const subject = `[Tooty] Migration ${input.action} on ${scopeLabel}`;
    const body =
      `Migration action detected.\n` +
      `Action: ${input.action}\n` +
      `Format: ${input.format}\n` +
      `Scope: ${scopeLabel}\n` +
      `Reason: ${input.reason || "(not provided)"}\n` +
      `From: ${actorEmail}\n` +
      `At: ${new Date().toISOString()}`;
    for (const email of uniqueRecipients) {
      await sendCommunication(
        {
          siteId: input.siteId || null,
          channel: "email",
          to: email,
          subject,
          body,
          category: "transactional",
          metadata: {
            kind: "migration_audit",
            action: input.action,
            format: input.format,
            siteId: input.siteId || null,
            actorUserId: input.actorUserId,
            actorEmail,
            reason: input.reason || null,
          },
        },
        { createdByUserId: input.actorUserId },
      );
    }
  } catch (error) {
    trace("migration", "failed to notify admins for migration action", {
      siteId: input.siteId || null,
      action: input.action,
      format: input.format,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function enforceExportVerification(input: {
  userId: string;
  siteId: string;
  format: string;
  providedCode: string;
  reason: string;
}) {
  const key = verificationKey(input.siteId, input.format);
  const raw = await getUserMetaValue(input.userId, key);
  const recipients = input.siteId ? await listSiteAdminEmails(input.siteId) : await listNetworkAdminEmails();
  const uniqueRecipients = Array.from(new Set(recipients.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
  if (uniqueRecipients.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Cannot export: no administrator email is configured for verification." },
      { status: 400 },
    );
  }
  const recipientLabel = input.siteId ? "site administrators" : "network administrators";

  let parsed: {
    code?: string;
    expiresAt?: string;
    sentTo?: string;
    sentVia?: string;
    failedAttempts?: number;
    lockedUntil?: string;
    lastRequestedAt?: string;
  } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    parsed = {};
  }

  const providedCode = toSafeString(input.providedCode);
  const now = Date.now();
  const expiresAt = Date.parse(String(parsed.expiresAt || ""));
  const isUnexpired = Number.isFinite(expiresAt) && expiresAt > now;
  const lockedUntilTs = Date.parse(String(parsed.lockedUntil || ""));
  const isLocked = Number.isFinite(lockedUntilTs) && lockedUntilTs > now;
  if (isLocked) {
    return NextResponse.json(
      {
        ok: false,
        error: "Verification is temporarily locked after too many invalid attempts.",
        requiresVerification: true,
        sentTo: parsed.sentTo || recipientLabel,
        sentVia: "email",
        lockedUntil: parsed.lockedUntil,
      },
      { status: 423 },
    );
  }

  if (providedCode && parsed.code && isUnexpired) {
    if (providedCode === String(parsed.code)) {
      await setUserMetaValue(input.userId, key, "");
      return null;
    }
    const failedAttempts = Math.max(0, Number(parsed.failedAttempts || 0)) + 1;
    const shouldLock = failedAttempts >= 5;
    const lockedUntil = shouldLock ? new Date(Date.now() + 15 * 60_000).toISOString() : "";
    await setUserMetaValue(
      input.userId,
      key,
      JSON.stringify({
        ...parsed,
        failedAttempts,
        lockedUntil: lockedUntil || undefined,
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid verification code.",
        requiresVerification: true,
        sentTo: parsed.sentTo || recipientLabel,
        sentVia: "email",
        attemptsRemaining: Math.max(0, 5 - failedAttempts),
        lockedUntil: lockedUntil || null,
      },
      { status: 403 },
    );
  }

  if (!providedCode && parsed.code && isUnexpired) {
    return NextResponse.json(
      {
        ok: false,
        error: "Verification code already issued and still pending.",
        requiresVerification: true,
        pending: true,
        sentTo: parsed.sentTo || recipientLabel,
        sentVia: "email",
        expiresAt: parsed.expiresAt || null,
      },
      { status: 428 },
    );
  }

  const lastRequestedAtTs = Date.parse(String(parsed.lastRequestedAt || ""));
  if (!providedCode && Number.isFinite(lastRequestedAtTs) && now - lastRequestedAtTs < 60_000 && isUnexpired) {
    return NextResponse.json(
      {
        ok: false,
        error: "Verification code already sent recently. Please wait before requesting another.",
        requiresVerification: true,
        sentTo: parsed.sentTo || recipientLabel,
        sentVia: "email",
      },
      { status: 429 },
    );
  }

  const code = issueCode();
  const nextExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
  await setUserMetaValue(
    input.userId,
    key,
    JSON.stringify({
      code,
      expiresAt: nextExpiry,
      sentTo: recipientLabel,
      sentVia: "email",
      failedAttempts: 0,
      lockedUntil: null,
      lastRequestedAt: new Date().toISOString(),
    }),
  );
  for (const email of uniqueRecipients) {
    await sendCommunication(
      {
        siteId: input.siteId || null,
        channel: "email",
        to: email,
        subject: "[Tooty] Migration export verification code",
        body:
          `A migration export was requested.\n` +
          `Verification code: ${code}\n` +
          `Scope: ${input.siteId ? `site ${input.siteId}` : "network"}\n` +
          `Format: ${input.format}\n` +
          `Expires: ${nextExpiry}`,
        category: "transactional",
        metadata: {
          kind: "migration_export_verification",
          siteId: input.siteId || null,
          format: input.format,
          sentTo: email,
          reason: input.reason || null,
        },
      },
      { createdByUserId: input.userId },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: "Verification code required to export.",
      requiresVerification: true,
      sentTo: recipientLabel,
      sentVia: "email",
    },
    { status: 428 },
  );
}

async function getExportVerificationStatus(input: { userId: string; siteId: string; format: string }) {
  const key = verificationKey(input.siteId, input.format);
  const raw = await getUserMetaValue(input.userId, key);
  const recipients = input.siteId ? await listSiteAdminEmails(input.siteId) : await listNetworkAdminEmails();
  const recipientLabel = input.siteId ? "site administrators" : "network administrators";
  const fallbackSentTo = recipients.length > 0 ? recipientLabel : recipientLabel;
  let parsed: {
    code?: string;
    expiresAt?: string;
    sentTo?: string;
    sentVia?: string;
    lockedUntil?: string;
  } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    parsed = {};
  }
  const now = Date.now();
  const expiresAt = Date.parse(String(parsed.expiresAt || ""));
  const isUnexpired = Number.isFinite(expiresAt) && expiresAt > now;
  const lockedUntilTs = Date.parse(String(parsed.lockedUntil || ""));
  const isLocked = Number.isFinite(lockedUntilTs) && lockedUntilTs > now;
  return {
    pending: Boolean(parsed.code && isUnexpired),
    isLocked,
    sentTo: parsed.sentTo || fallbackSentTo,
    sentVia: parsed.sentVia || "email",
    expiresAt: parsed.expiresAt || null,
    lockedUntil: parsed.lockedUntil || null,
  };
}

async function cancelExportVerification(input: { userId: string; siteId: string; format: string }) {
  const key = verificationKey(input.siteId, input.format);
  await setUserMetaValue(input.userId, key, "");
}

async function notifyExportOutcomeNetworkAdmins(input: {
  actorUserId: string;
  siteId: string;
  format: string;
  reason: string;
  outcome: "success" | "failed";
  status: number;
  error?: string;
}) {
  try {
    const actor = await db.query.users.findFirst({
      where: eq(users.id, input.actorUserId),
      columns: { email: true },
    });
    const actorEmail = String(actor?.email || "").trim() || input.actorUserId;
    const recipients = await listNetworkAdminEmails();
    if (recipients.length === 0) return;
    const uniqueRecipients = Array.from(new Set(recipients));
    const scopeLabel = input.siteId ? `site ${input.siteId}` : "network";
    const subject = `[Tooty] Export ${input.outcome.toUpperCase()} (${scopeLabel})`;
    const body =
      `Export outcome alert.\n` +
      `Outcome: ${input.outcome}\n` +
      `Status: ${input.status}\n` +
      `Format: ${input.format}\n` +
      `Scope: ${scopeLabel}\n` +
      `Reason: ${input.reason || "(not provided)"}\n` +
      `From: ${actorEmail}\n` +
      `At: ${new Date().toISOString()}` +
      (input.error ? `\nError: ${input.error}` : "");
    for (const email of uniqueRecipients) {
      await sendCommunication(
        {
          siteId: input.siteId || null,
          channel: "email",
          to: email,
          subject,
          body,
          category: "transactional",
          metadata: {
            kind: "migration_export_outcome",
            outcome: input.outcome,
            status: input.status,
            siteId: input.siteId || null,
            format: input.format,
            reason: input.reason || null,
            error: input.error || null,
            actorUserId: input.actorUserId,
            actorEmail,
          },
        },
        { createdByUserId: input.actorUserId },
      );
    }
  } catch (error) {
    trace("migration", "failed to notify network admins for export outcome", {
      siteId: input.siteId || null,
      format: input.format,
      outcome: input.outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = toSafeString(body.action) as ActionName;
  const siteId = toSafeString(body.siteId);
  const format = toSafeString(body.format).toLowerCase();

  const migrationPluginActive = await isMigrationPluginActive(siteId);
  if (!migrationPluginActive) {
    return NextResponse.json(
      { ok: false, error: "Migration Kit plugin is not active." },
      { status: 404 },
    );
  }

  const canManageNetworkPlugins = await userCan("network.plugins.manage", session.user.id);
  const canManageSiteSettings = siteId
    ? await userCan("site.settings.write", session.user.id, { siteId })
    : false;
  const allowed = siteId ? canManageNetworkPlugins || canManageSiteSettings : canManageNetworkPlugins;
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const kernel = await createKernelForRequest(siteId || undefined);
  const sendQuery = async (name: string, params: Record<string, unknown>) => {
    const response = await kernel.applyFilters<Response | null>("domain:query", null, { name, params });
    if (!(response instanceof Response)) {
      return NextResponse.json({ ok: false, error: "Migration provider did not return a response." }, { status: 500 });
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => ({ ok: false, error: "Invalid provider response." }));
      return NextResponse.json(payload, { status: response.status });
    }
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };

  if (action === "providers") {
    return sendQuery("export_import.providers", { siteId });
  }

  if (action === "export.status") {
    if (!format) return NextResponse.json({ ok: false, error: "Format is required." }, { status: 400 });
    const status = await getExportVerificationStatus({
      userId: session.user.id,
      siteId,
      format,
    });
    return NextResponse.json({ ok: true, requiresVerification: status.pending, ...status }, { status: 200 });
  }

  if (action === "export.cancel") {
    if (!format) return NextResponse.json({ ok: false, error: "Format is required." }, { status: 400 });
    await cancelExportVerification({
      userId: session.user.id,
      siteId,
      format,
    });
    await notifyMigrationAdmins({
      actorUserId: session.user.id,
      siteId,
      action,
      format,
      reason: "User canceled pending export verification.",
    });
    return NextResponse.json({ ok: true, canceled: true }, { status: 200 });
  }

  if (action === "export" || action === "export.inspect") {
    if (!format) return NextResponse.json({ ok: false, error: "Format is required." }, { status: 400 });
    const exportReason = toSafeString(body.exportReason);
    if (!exportReason || exportReason.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Export reason is required (minimum 8 characters)." },
        { status: 400 },
      );
    }
    const isActualExport = action === "export";
    if (isActualExport) {
      const verificationResponse = await enforceExportVerification({
        userId: session.user.id,
        siteId,
        format,
        providedCode: toSafeString(body.verificationCode),
        reason: exportReason,
      });
      if (verificationResponse) return verificationResponse;
      await notifyMigrationAdmins({ actorUserId: session.user.id, siteId, action, format, reason: exportReason });
    }
    try {
      const normalizedOptions = normalizeExportOptionsForFormat(
        format,
        body.options && typeof body.options === "object" ? (body.options as Record<string, unknown>) : {},
      );
      const exportQueryInput = {
        siteId,
        format,
        verificationCode: toSafeString(body.verificationCode),
        deliveryEmail: toSafeString(body.deliveryEmail) || null,
        exportReason,
        options: normalizedOptions,
      };
      if (!isActualExport) {
        const estimates = await estimateDryRunBands({
          siteId,
          format,
          options: normalizedOptions,
        });
        const providerResponse = await kernel.applyFilters<Response | null>("domain:query", null, {
          name: "export_import.export",
          params: exportQueryInput,
        });
        if (!(providerResponse instanceof Response)) {
          return NextResponse.json({ ok: false, error: "Migration provider did not return a response." }, { status: 500 });
        }
        const contentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("application/json")) {
          return NextResponse.json(
            {
              ok: true,
              mode: "dry-run",
              redacted: true,
              format,
              siteId: siteId || "",
              generatedAt: new Date().toISOString(),
              report: {
                scope: siteId ? "site" : "network",
                reasonProvided: exportReason.length >= 8,
                selectedDomainCountBand: estimates.selectedDomainCountBand,
                selectedDomains: estimates.selectedDomains,
                estimatedVolumes: {
                  availableDomainsBand: estimates.availableDomainsBand,
                  articlesBand: estimates.articlesBand,
                  usersBand: estimates.usersBand,
                  mediaItemsBand: estimates.mediaItemsBand,
                  mediaSizeBand: estimates.mediaSizeBand,
                },
                formatFamily: isSnapshotFormat(format) ? "snapshot" : isArticlesFormat(format) ? "articles" : "generic",
                includes: isSnapshotFormat(format)
                  ? {
                      entries: normalizedOptions.includeEntries !== false,
                      domains: normalizedOptions.includeDomains !== false,
                      settings: normalizedOptions.includeSettings !== false,
                      mediaMode: String(normalizedOptions.includeMedia || "references"),
                      usersMode: String(normalizedOptions.includeUsers || "site-users"),
                    }
                  : {
                      content: false,
                      seo: false,
                      featuredMedia: false,
                      mediaManifest: false,
                      metaMode: "unknown",
                    },
                notes: [
                  "Provider returned non-JSON dry-run data; showing generic redacted preview only.",
                  "Dry run preview is redacted by design and does not return exportable records.",
                ],
              },
              warnings: [
                "Dry run provider response was non-JSON; exact payload preview is unavailable.",
              ],
              provider: {
                id: format,
                label: format,
                source: "provider",
                enabled: true,
                capabilities: {},
              },
            },
            { status: 200 },
          );
        }
        const raw = (await providerResponse.json().catch(() => ({ ok: false, error: "Invalid provider response." }))) as Record<string, unknown>;
        if (providerResponse.status >= 400 || raw.ok === false) {
          return NextResponse.json(raw, { status: providerResponse.status });
        }
        return NextResponse.json(
          buildRedactedExportInspectResult({
            source: raw,
            siteId,
            format,
            exportReason,
            estimates,
          }),
          { status: providerResponse.status },
        );
      }
      const response = await sendQuery("export_import.export", exportQueryInput);
      if (isActualExport && response.ok) {
        try {
          const actor = await db.query.users.findFirst({
            where: eq(users.id, session.user.id),
            columns: { email: true },
          });
          const deliveryEmail =
            toSafeString(body.deliveryEmail).toLowerCase() ||
            toSafeString(actor?.email).toLowerCase();
          if (deliveryEmail) {
            const contentType = String(response.headers.get("content-type") || "application/octet-stream");
            const defaultFileName = `export-${format}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionFromMime(contentType, "bin")}`;
            const fileName = parseFilenameFromDisposition(
              String(response.headers.get("content-disposition") || ""),
              defaultFileName,
            );
            const bytes = new Uint8Array(await response.clone().arrayBuffer());
            const persisted = await storeExportArtifactInMedia({
              siteId,
              userId: session.user.id,
              format,
              bytes,
              contentType,
              fileName,
            });
            const artifact = await createExportArtifactToken({
              siteId,
              userId: session.user.id,
              format,
              mediaObjectKey: persisted.key,
              mediaUrl: persisted.url,
              mimeType: contentType,
              fileName,
            });
            const linkUrl = `${appBaseUrl()}/api/plugins/export-import/download?token=${encodeURIComponent(artifact.token)}`;
            await sendExportDeliveryLinkToUser({
              actorUserId: session.user.id,
              siteId,
              format,
              reason: exportReason,
              deliveryEmail,
              linkUrl,
              expiresAt: artifact.expiresAt,
            });
          }
        } catch (deliveryError) {
          trace("migration", "failed to persist/send export delivery link", {
            siteId: siteId || null,
            format,
            error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
          });
        }
      }
      if (isActualExport) {
        await notifyExportOutcomeNetworkAdmins({
          actorUserId: session.user.id,
          siteId,
          format,
          reason: exportReason,
          outcome: response.ok ? "success" : "failed",
          status: response.status,
          error: response.ok ? undefined : `Provider returned status ${response.status}`,
        });
      }
      return response;
    } catch (error) {
      if (isActualExport) {
        await notifyExportOutcomeNetworkAdmins({
          actorUserId: session.user.id,
          siteId,
          format,
          reason: exportReason,
          outcome: "failed",
          status: 500,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  if (action === "import.inspect" || action === "import.apply") {
    if (!format) return NextResponse.json({ ok: false, error: "Format is required." }, { status: 400 });
    let importInput:
      | {
          payload?: unknown;
          payloadBase64?: string;
          payloadEncoding?: string;
          payloadMimeType?: string;
          payloadUrl?: string;
        }
      | null = null;
    try {
      importInput = await resolvePayload(body);
    } catch (error: any) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid import payload." }, { status: 400 });
    }
    if (importInput === null) {
      return NextResponse.json({ ok: false, error: "Import payload is required." }, { status: 400 });
    }
    const pending = await findPendingMigrationOperation({ siteId, action, format });
    if (pending) {
      return NextResponse.json(
        {
          ok: false,
          error: "An import operation is already pending for this scope/format. Please wait for it to finish.",
          pending: true,
          operationId: pending.id,
          createdAt: pending.createdAt,
        },
        { status: 409 },
      );
    }
    const operationId = await createPendingMigrationOperation({
      userId: session.user.id,
      siteId,
      action,
      format,
    });
    await notifyMigrationAdmins({
      actorUserId: session.user.id,
      siteId,
      action,
      format,
      reason: toSafeString(body.exportReason),
    });
    try {
      const response = await sendQuery(
        action === "import.inspect" ? "export_import.import.inspect" : "export_import.import.apply",
        {
          siteId,
          format,
          ...importInput,
        },
      );
      await finalizeMigrationOperation(operationId, {
        status: response.ok ? "completed" : "failed",
        error: response.ok ? undefined : `Provider returned status ${response.status}`,
      });
      return response;
    } catch (error) {
      await finalizeMigrationOperation(operationId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = toSafeString(url.searchParams.get("token"));
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  }

  await ensureExportArtifactsTable();
  const table = sql.raw(quotedTable(exportArtifactsTableName()));
  const rows = await db.execute(sql`
    SELECT token, site_id, media_object_key, media_url, mime_type, file_name, expires_at
    FROM ${table}
    WHERE token = ${token}
    LIMIT 1
  `);
  const row = (rows as any)?.rows?.[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: "Export link not found." }, { status: 404 });
  }

  const expiresAt = Date.parse(String(row.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return NextResponse.json(
      { ok: false, error: "Export link expired. This file is no longer available." },
      { status: 410 },
    );
  }

  const mediaUrl = String(row.media_url || "").trim();
  const mediaObjectKey = String(row.media_object_key || "").trim();
  const mimeType = String(row.mime_type || "application/octet-stream");
  const fileName = String(row.file_name || `export-${token}.bin`);
  if (!mediaUrl && !mediaObjectKey) {
    return NextResponse.json({ ok: false, error: "Export artifact is unavailable." }, { status: 404 });
  }

  if (mediaObjectKey && process.env.AWS_S3_BUCKET) {
    try {
      const s3Object = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: mediaObjectKey,
        }),
      );
      const bytes = s3Object.Body
        ? await (s3Object.Body as any).transformToByteArray()
        : new Uint8Array();
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": String(s3Object.ContentType || mimeType),
          "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
          "cache-control": "private, no-store",
        },
      });
    } catch (error) {
      trace("migration", "failed to read private export artifact from s3", {
        token,
        key: mediaObjectKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ ok: false, error: "Export artifact could not be loaded." }, { status: 502 });
    }
  }

  if (mediaUrl.startsWith("data:")) {
    const base64Match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      return NextResponse.json({ ok: false, error: "Invalid artifact encoding." }, { status: 500 });
    }
    const raw = Buffer.from(base64Match[2], "base64");
    return new Response(raw, {
      status: 200,
      headers: {
        "content-type": base64Match[1] || mimeType,
        "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const upstream = await fetch(mediaUrl, { method: "GET" });
  if (!upstream.ok) {
    return NextResponse.json({ ok: false, error: "Export artifact could not be loaded." }, { status: 502 });
  }
  const bytes = await upstream.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": String(upstream.headers.get("content-type") || mimeType),
      "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
