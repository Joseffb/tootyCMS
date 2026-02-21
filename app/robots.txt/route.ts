import { NextResponse } from "next/server";
import { getBooleanSetting, getSiteUrlSetting, SEO_INDEXING_ENABLED_KEY } from "@/lib/cms-config";

function resolveBaseUrl(configuredSiteUrl: string) {
  if (configuredSiteUrl) return configuredSiteUrl;
  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;
  }
  return "http://localhost:3000";
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
