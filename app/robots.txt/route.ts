import { NextResponse } from "next/server";
import { getBooleanSetting, getSiteUrlSetting, SEO_INDEXING_ENABLED_KEY } from "@/lib/cms-config";
import { getRootSiteUrl } from "@/lib/site-url";

function resolveBaseUrl(configuredSiteUrl: string) {
  return configuredSiteUrl || getRootSiteUrl();
}

export async function GET() {
  const [siteUrlSetting, indexingEnabled] = await Promise.all([
    getSiteUrlSetting(),
    getBooleanSetting(SEO_INDEXING_ENABLED_KEY, true),
  ]);

  const baseUrl = resolveBaseUrl(siteUrlSetting.value);
  const sitemapUrl = `${baseUrl.replace(/\/$/, "")}/sitemap.xml`;

  const body = indexingEnabled
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /app/",
        "Disallow: /api/",
        `Sitemap: ${sitemapUrl}`,
      ].join("\n")
    : [
        "User-agent: *",
        "Disallow: /",
        `Sitemap: ${sitemapUrl}`,
      ].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
