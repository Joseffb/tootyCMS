import { and, asc, count, eq, inArray, lt } from "drizzle-orm";

import db from "@/lib/db";
import { getSiteTextSetting } from "@/lib/cms-config";
import { media } from "@/lib/schema";

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

  const rows = await db
    .select({ value: count() })
    .from(media)
    .where(eq(media.siteId, siteId));
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

  const where = siteId
    ? and(eq(media.siteId, siteId), lt(media.createdAt, cutoff))
    : lt(media.createdAt, cutoff);

  const rows = await db
    .select({ id: media.id })
    .from(media)
    .where(where)
    .orderBy(asc(media.createdAt))
    .limit(limit);

  const ids = rows.map((row) => row.id).filter((id): id is number => Number.isFinite(Number(id)));
  if (ids.length === 0) {
    return {
      deleted: 0,
      olderThanDays,
      limit,
      siteId,
    };
  }

  await db
    .delete(media)
    .where(inArray(media.id, ids));

  return {
    deleted: ids.length,
    olderThanDays,
    limit,
    siteId,
  };
}
