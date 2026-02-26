import { count, eq } from "drizzle-orm";

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
