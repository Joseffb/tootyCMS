import { getAllPosts } from "@/lib/fetchers";
import { getSiteUrlSetting, getSiteWritingSettings } from "@/lib/cms-config";
import { isMissingConnectionStringError, isMissingRelationError } from "@/lib/db-errors";
import { buildDetailPath } from "@/lib/permalink";
import { getRootSiteUrl, isLocalHostLike } from "@/lib/site-url";
import { NextResponse } from "next/server";

function escapeXml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function resolveBaseUrl(configuredSiteUrl: string) {
  return configuredSiteUrl || getRootSiteUrl();
}

function buildPostUrl(domain: string, slug: string) {
  const protocol = isLocalHostLike(domain) ? "http" : "https";
  const cleanSlug = slug.replace(/^\/+/, "");
  return `${protocol}://${domain}/${cleanSlug}`;
}

function buildDetailUrl(domain: string, detailPath: string) {
  const protocol = isLocalHostLike(domain) ? "http" : "https";
  const cleanPath = detailPath.startsWith("/") ? detailPath : `/${detailPath}`;
  return `${protocol}://${domain}${cleanPath}`;
}

export async function GET() {
  let posts = [] as Awaited<ReturnType<typeof getAllPosts>>;
  let baseUrl = getRootSiteUrl();

  try {
    posts = await getAllPosts();
  } catch (error) {
    // Build may run without DB env (CI); fallback to homepage-only sitemap.
    if (!isMissingRelationError(error) && !isMissingConnectionStringError(error)) throw error;
  }

  try {
    const siteUrl = await getSiteUrlSetting();
    baseUrl = resolveBaseUrl(siteUrl.value);
  } catch (error) {
    // Fresh installs may not have cms_settings yet; CI build may also run without DB env.
    if (!isMissingRelationError(error) && !isMissingConnectionStringError(error)) throw error;
  }

  const homepage = `<url><loc>${escapeXml(baseUrl)}</loc><lastmod>${new Date().toISOString()}</lastmod></url>`;

  const writingBySiteId = new Map<string, Awaited<ReturnType<typeof getSiteWritingSettings>>>();
  await Promise.all(
    [...new Set(posts.map((post) => post.siteId).filter(Boolean))].map(async (siteId) => {
      try {
        writingBySiteId.set(siteId, await getSiteWritingSettings(siteId));
      } catch (error) {
        if (!isMissingRelationError(error) && !isMissingConnectionStringError(error)) throw error;
      }
    }),
  );

  const postEntries = posts.map((post) => {
    const writing = writingBySiteId.get(post.siteId);
    const detailPath = writing
      ? buildDetailPath(post.dataDomain || "post", post.slug, writing)
      : `/${(post.dataDomain || "post").replace(/^\/+|\/+$/g, "")}/${post.slug.replace(/^\/+/, "")}`;
    const loc = writing ? buildDetailUrl(post.domain, detailPath) : buildPostUrl(post.domain, post.slug);
    const lastmod = (post.updatedAt || new Date()).toISOString();
    return `<url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`;
  });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[homepage, ...postEntries].join("\n")}
</urlset>`;

  return new NextResponse(sitemap, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
