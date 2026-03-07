import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getThemeDevCacheBustToken, isThemeDevDynamicMode } from "@/lib/theme-dev-mode";
import { listSiteDomainPosts } from "@/lib/site-domain-post-store";

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
  if (isThemeDevDynamicMode()) {
    return getThemeDevCacheBustToken();
  }

  const [siteRow, posts] = await Promise.all([
    db
      .select({ updatedAt: sites.updatedAt })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
      .then((rows) => rows[0] || null),
    listSiteDomainPosts({
      siteId,
      includeInactiveDomains: false,
      includeContent: false,
    }),
  ]);

  const siteUpdated = toMillis(siteRow?.updatedAt);
  const postsUpdated = posts.reduce((max, post) => Math.max(max, toMillis(post.updatedAt)), 0);
  const token = Math.max(siteUpdated, postsUpdated);
  return token > 0 ? String(token) : "0";
}

export function withCacheBust(url: string, token: string) {
  if (!url || !token || token === "0") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(token)}`;
}
