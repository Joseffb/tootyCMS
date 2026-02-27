import db from "@/lib/db";
import { domainPosts, sites } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

function toMillis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return 0;
}

export async function getThemeCacheBustToken(siteId: string) {
  const [siteRow, postsRow] = await Promise.all([
    db
      .select({ updatedAt: sites.updatedAt })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
      .then((rows) => rows[0] || null),
    db
      .select({
        updatedAt: sql<string | Date | null>`max(${domainPosts.updatedAt})`,
      })
      .from(domainPosts)
      .where(eq(domainPosts.siteId, siteId))
      .then((rows) => rows[0] || null),
  ]);

  const siteUpdated = toMillis(siteRow?.updatedAt);
  const postsUpdated = toMillis(postsRow?.updatedAt);
  const token = Math.max(siteUpdated, postsUpdated);
  return token > 0 ? String(token) : "0";
}

export function withCacheBust(url: string, token: string) {
  if (!url || !token || token === "0") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(token)}`;
}

