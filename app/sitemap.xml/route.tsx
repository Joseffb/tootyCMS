import { getAllPosts } from "@/lib/fetchers";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { isMissingRelationError } from "@/lib/db-errors";
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

export async function GET() {
  let posts = await getAllPosts();
  let baseUrl = getRootSiteUrl();
  try {
    const siteUrl = await getSiteUrlSetting();
    baseUrl = resolveBaseUrl(siteUrl.value);
  } catch (error) {
    // Fresh installs may not have cms_settings yet.
    if (!isMissingRelationError(error)) throw error;
  }

  const homepage = `<url><loc>${escapeXml(baseUrl)}</loc><lastmod>${new Date().toISOString()}</lastmod></url>`;

  const postEntries = posts.map((post) => {
    const loc = buildPostUrl(post.domain, post.slug);
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
