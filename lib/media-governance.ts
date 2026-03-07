import { asc, count, inArray, lt } from "drizzle-orm";

import db from "@/lib/db";
import { getSiteTextSetting } from "@/lib/cms-config";
import { sites } from "@/lib/schema";
import { ensureSiteMediaTable, getSiteMediaTable } from "@/lib/site-media-tables";

function normalizeNonNegativeInt(input: string, fallback = 0) {
  const value = Number.parseInt(String(input || "").trim(), 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export type SiteMediaQuotaResult = {
  allowed: boolean;
  maxItems: number;
  currentItems: number;
};

export async function assertSiteMediaQuotaAvailable(siteId: string): Promise<SiteMediaQuotaResult> {
  const raw = await getSiteTextSetting(siteId, "media_max_items", "0");
  const maxItems = normalizeNonNegativeInt(raw, 0);
  if (maxItems <= 0) {
    return { allowed: true, maxItems: 0, currentItems: 0 };
  }

  await ensureSiteMediaTable(siteId);
  const media = getSiteMediaTable(siteId);
  const rows = await db
    .select({ value: count() })
    .from(media);
  const currentItems = Number(rows[0]?.value ?? 0);
  return {
    allowed: currentItems < maxItems,
    maxItems,
    currentItems,
  };
}

function normalizePositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export type MediaCleanupResult = {
  deleted: number;
  olderThanDays: number;
  limit: number;
  siteId: string | null;
};

export async function purgeOldMediaRecords(input?: {
  siteId?: string | null;
  olderThanDays?: number;
  limit?: number;
}): Promise<MediaCleanupResult> {
  const siteId = typeof input?.siteId === "string" && input.siteId.trim() ? input.siteId.trim() : null;
  const olderThanDays = normalizePositiveInt(input?.olderThanDays, 30, 1, 3650);
  const limit = normalizePositiveInt(input?.limit, 100, 1, 2000);
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const siteRowsRaw =
    (await db.query?.sites?.findMany?.({ columns: { id: true } })) ??
    (await db.select({ id: sites.id }).from(sites).orderBy(asc(sites.id)));
  const targetSiteIds = siteId
    ? [siteId]
    : (Array.isArray(siteRowsRaw) ? siteRowsRaw : []).map((row) => String(row.id || "").trim()).filter(Boolean);

  let deleted = 0;
  for (const currentSiteId of targetSiteIds) {
    await ensureSiteMediaTable(currentSiteId);
    const media = getSiteMediaTable(currentSiteId);
    const rows = await db
      .select({ id: media.id })
      .from(media)
      .where(lt(media.createdAt, cutoff))
      .orderBy(asc(media.createdAt))
      .limit(Math.max(limit - deleted, 0));
    const ids = rows.map((row) => row.id).filter((id): id is number => Number.isFinite(Number(id)));
    if (!ids.length) continue;
    await db.delete(media).where(inArray(media.id, ids));
    deleted += ids.length;
    if (deleted >= limit) break;
  }

  return {
    deleted,
    olderThanDays,
    limit,
    siteId,
  };
}
