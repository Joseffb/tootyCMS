import {
  getEffectiveSiteRssSettings,
  getSiteUrlSettingForSite,
  getSiteWritingSettings,
} from "@/lib/cms-config";
import { getDomainPostsForSite, getSiteData } from "@/lib/fetchers";
import { buildDetailPath } from "@/lib/permalink";
import { getSitePublicUrl } from "@/lib/site-url";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { NextResponse } from "next/server";

export const revalidate = 900;

type FeedEntry = Awaited<ReturnType<typeof getDomainPostsForSite>>[number] & {
  dataDomainKey: string;
};

function firstHeaderValue(raw: string | null) {
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

function normalizeHost(rawValue: string) {
  return rawValue.trim().toLowerCase().replace(/:\d+$/, "");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeEntry(description: string, htmlContent: string) {
  const preferred = description.trim();
  if (preferred) return preferred;
  const plainText = stripHtml(htmlContent);
  if (!plainText) return "";
  return plainText.length > 280 ? `${plainText.slice(0, 277).trimEnd()}...` : plainText;
}

function resolveRequestHost(request: Request) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(request.headers.get("host")) || new URL(request.url).host;
  return normalizeHost(host);
}

function buildFeedXml(input: {
  siteUrl: string;
  siteName: string;
  siteDescription: string;
  items: Array<{
    title: string;
    link: string;
    guid: string;
    pubDate: string;
    description: string;
    encodedContent?: string;
  }>;
}) {
  const channelDescription = input.siteDescription.trim() || `Latest updates from ${input.siteName}`;
  const itemXml = input.items
    .map((item) => {
      const encodedContent = item.encodedContent?.trim()
        ? `\n    <content:encoded><![CDATA[${item.encodedContent}]]></content:encoded>`
        : "";
      return [
        "  <item>",
        `    <title>${escapeXml(item.title)}</title>`,
        `    <link>${escapeXml(item.link)}</link>`,
        `    <guid isPermaLink="true">${escapeXml(item.guid)}</guid>`,
        `    <pubDate>${item.pubDate}</pubDate>`,
        `    <description>${escapeXml(item.description)}</description>${encodedContent}`,
        "  </item>",
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${escapeXml(input.siteName)}</title>
  <link>${escapeXml(input.siteUrl)}</link>
  <description>${escapeXml(channelDescription)}</description>
  <atom:link href="${escapeXml(`${input.siteUrl.replace(/\/$/, "")}/feed.xml`)}" rel="self" type="application/rss+xml" />
  <generator>Tooty CMS</generator>
${itemXml}
</channel>
</rss>`;
}

export async function GET(request: Request) {
  const host = resolveRequestHost(request);
  if (!host) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const site = await getSiteData(host);
  if (!site?.id) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const rssSettings = await getEffectiveSiteRssSettings(String(site.id));
  if (!rssSettings.networkEnabled || !rssSettings.enabled) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const derivedSiteUrl = getSitePublicUrl({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary: Boolean((site as { isPrimary?: boolean }).isPrimary) || site.subdomain === "main",
  });
  const [configuredSiteUrl, writingSettings, domainEntries] = await Promise.all([
    getSiteUrlSettingForSite(String(site.id), derivedSiteUrl),
    getSiteWritingSettings(String(site.id)),
    Promise.all(
      rssSettings.includedDomainKeys.map(async (dataDomainKey) => {
        const rows = await getDomainPostsForSite(host, dataDomainKey);
        return rows.map(
          (row): FeedEntry => ({
            ...row,
            dataDomainKey,
          }),
        );
      }),
    ),
  ]);

  const siteUrl = configuredSiteUrl.value.trim() || derivedSiteUrl;
  const items = domainEntries
    .flat()
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, rssSettings.itemsPerFeed)
    .map((entry) => {
      const detailPath = buildDetailPath(entry.dataDomainKey, entry.slug, writingSettings);
      const link = `${siteUrl.replace(/\/$/, "")}${detailPath}`;
      const htmlContent = toThemePostHtml(entry.content || "");
      const summary = summarizeEntry(entry.description || "", htmlContent);
      return {
        title: entry.title || "Untitled",
        link,
        guid: link,
        pubDate: entry.createdAt.toUTCString(),
        description: summary,
        encodedContent: rssSettings.contentMode === "full" ? htmlContent : undefined,
      };
    });

  const xml = buildFeedXml({
    siteUrl,
    siteName: String(site.name || "Tooty Site").trim() || "Tooty Site",
    siteDescription: String(site.heroSubtitle || site.description || "").trim(),
    items,
  });

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
