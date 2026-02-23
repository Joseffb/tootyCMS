import { NextResponse } from "next/server";
import { getBooleanSetting, getSiteUrlSetting, SEO_INDEXING_ENABLED_KEY } from "@/lib/cms-config";
import { isMissingRelationError } from "@/lib/db-errors";
import { getRootSiteUrl } from "@/lib/site-url";

function resolveBaseUrl(configuredSiteUrl: string) {
  return configuredSiteUrl || getRootSiteUrl();
}

export async function GET() {
  let baseUrl = getRootSiteUrl();
  let indexingEnabled = true;
  try {
    const [siteUrlSetting, indexingSetting] = await Promise.all([
      getSiteUrlSetting(),
      getBooleanSetting(SEO_INDEXING_ENABLED_KEY, true),
    ]);
    baseUrl = resolveBaseUrl(siteUrlSetting.value);
    indexingEnabled = indexingSetting;
  } catch (error) {
    // Fresh installs may not have cms_settings yet.
    if (!isMissingRelationError(error)) throw error;
  }
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
