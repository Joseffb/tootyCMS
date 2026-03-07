import db from "@/lib/db";
import { ensureSiteCommentTables } from "@/lib/site-comment-tables";
import { listSiteDomainPostMetaMany } from "@/lib/site-domain-post-store";
import { sql } from "drizzle-orm";
import { parseViewCount, VIEW_COUNT_META_KEY } from "@/lib/view-count";

type QueryRows<T> = { rows?: T[] };

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function toInt(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getApprovedCommentCountsBySite(postIdsBySite: Map<string, string[]>) {
  const counts = new Map<string, number>();
  for (const [siteIdRaw, postIdsRaw] of postIdsBySite.entries()) {
    const siteId = String(siteIdRaw || "").trim();
    if (!siteId) continue;
    const postIds = Array.from(new Set(postIdsRaw.map((id) => String(id || "").trim()).filter(Boolean)));
    if (postIds.length === 0) continue;
    try {
      const { commentsTable } = await ensureSiteCommentTables(siteId);
      const placeholders = postIds.map((id) => sql`${id}`);
      const rows = (await db.execute(sql`
        SELECT "context_id" AS "contextId", COUNT(*)::int AS "total"
        FROM ${sql.raw(quoteIdentifier(commentsTable))}
        WHERE "context_type" = 'entry'
          AND "status" = 'approved'
          AND "context_id" IN (${sql.join(placeholders, sql`, `)})
        GROUP BY "context_id"
      `)) as QueryRows<{ contextId?: string | null; total?: number | string | null }>;
      for (const row of rows.rows ?? []) {
        const postId = String(row.contextId || "").trim();
        if (!postId) continue;
        counts.set(postId, toInt(row.total));
      }
    } catch {
      // If site comment tables are unavailable, keep popularity fallback at zero.
      continue;
    }
  }
  return counts;
}

export async function getViewCountsByPost(input: Array<{
  id: string;
  siteId: string;
  dataDomainKey: string;
}>) {
  const counts = new Map<string, number>();
  const grouped = new Map<string, { siteId: string; dataDomainKey: string; postIds: string[] }>();
  for (const row of input) {
    const postId = String(row.id || "").trim();
    const siteId = String(row.siteId || "").trim();
    const dataDomainKey = String(row.dataDomainKey || "").trim();
    if (!postId || !siteId || !dataDomainKey) continue;
    const key = `${siteId}:${dataDomainKey}`;
    const bucket = grouped.get(key) || { siteId, dataDomainKey, postIds: [] };
    bucket.postIds.push(postId);
    grouped.set(key, bucket);
  }

  for (const bucket of grouped.values()) {
    const rows = await listSiteDomainPostMetaMany({
      siteId: bucket.siteId,
      dataDomainKey: bucket.dataDomainKey,
      postIds: Array.from(new Set(bucket.postIds)),
      keys: [VIEW_COUNT_META_KEY],
    });
    for (const row of rows) {
      const postId = String(row.domainPostId || "").trim();
      if (!postId) continue;
      counts.set(postId, parseViewCount(row.value));
    }
  }

  return counts;
}
