import BlurImage from "@/components/blur-image";
import type { SelectSite } from "@/lib/schema";
import { placeholderBlurhash } from "@/lib/utils";
import { BarChart } from "lucide-react";
import Link from "next/link";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { DEFAULT_TOOTY_IMAGE } from "@/lib/tooty-images";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Build an absolute URL pointing to this same Next.js instance so that
 *  `fetch` from a Server Component can reach our `/api/*` routes.              */
function apiUrl(path: string) {
  const base =
    process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : getRootSiteUrl();
  return `${base}${path}`;
}

function collapseDuplicatePort(input: string) {
  return input.replace(/:(\d+):\1(?=\/|$)/g, ":$1");
}

function normalizePublicUrl(raw: string) {
  const trimmed = collapseDuplicatePort(String(raw || "").trim());
  if (!trimmed) return trimmed;
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const withProtocol = hasProtocol ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    const safeHost = collapseDuplicatePort(parsed.host);
    return `${parsed.protocol}//${safeHost}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

type TrendMetric = {
  deltaPct: number;
  trend: "up" | "down" | "flat";
};

/** Call analytics query endpoint and derive day-over-day trend for a site/domain. */
async function getDomainTrend(domain: string, siteId: string): Promise<TrendMetric | null> {
  try {
    const qs = new URLSearchParams({ name: "visitors_per_day", domain, siteId }).toString();
    const res = await fetch(apiUrl(`/api/analytics/query?${qs}`), {
      // cache for 60 s on the server to avoid hammering provider backends
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      if (process.env.DEBUG_MODE === "1" || process.env.DEBUG_MODE === "true") {
        console.warn("[analytics trend]", domain, await res.text());
      }
      return null;
    }

    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) return { deltaPct: 0, trend: "flat" };

    const normalized = rows
      .map((row: any) => ({
        date: String(row?.date || ""),
        value: Number(row?.total_pageviews ?? row?.unique_visitors ?? row?.visitors ?? 0),
      }))
      .filter((row: any) => row.date && Number.isFinite(row.value))
      .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date));

    if (normalized.length === 0) return { deltaPct: 0, trend: "flat" };
    const latest = Number(normalized[normalized.length - 1]?.value || 0);
    const previous = Number(normalized[normalized.length - 2]?.value || 0);

    let deltaPct = 0;
    if (previous > 0) {
      deltaPct = Math.round((((latest - previous) / previous) * 100) * 10) / 10;
    } else if (latest > 0) {
      deltaPct = 100;
    }

    const flatThresholdPct = 4;
    if (Math.abs(deltaPct) <= flatThresholdPct) {
      return { deltaPct: Math.abs(deltaPct), trend: "flat" };
    }
    if (deltaPct > 0) return { deltaPct, trend: "up" };
    return { deltaPct: Math.abs(deltaPct), trend: "down" };
  } catch (err) {
    if (process.env.DEBUG_MODE === "1" || process.env.DEBUG_MODE === "true") {
      console.warn("[analytics trend] fetch failed", err);
    }
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default async function SiteCard({
  data,
  rootUrl,
  hasAnalytics = false,
}: {
  data: SelectSite;
  rootUrl?: string;
  hasAnalytics?: boolean;
}) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
  const rootDomainHost = rootDomain.replace(/:\d+$/, "");
  const isMainSite = data.subdomain === "main";
  const domain = isMainSite ? rootDomain : `${data.subdomain}.${rootDomain}`;
  const analyticsDomain = isMainSite ? rootDomainHost : `${data.subdomain}.${rootDomainHost}`;
  const trend = hasAnalytics ? await getDomainTrend(analyticsDomain, data.id) : null;

  let publicUrl = getSitePublicUrl({
    subdomain: data.subdomain,
    customDomain: data.customDomain,
    isPrimary: isMainSite,
  });
  let publicLabel = domain;

  if (rootUrl && isMainSite) {
    publicUrl = rootUrl;
    try {
      publicLabel = new URL(normalizePublicUrl(rootUrl)).host;
    } catch {
      publicLabel = collapseDuplicatePort(rootUrl.replace(/^https?:\/\//, ""));
    }
  }
  publicUrl = normalizePublicUrl(publicUrl);
  publicLabel = collapseDuplicatePort(publicLabel);

  return (
    <div className="relative rounded-lg border border-stone-200 pb-10 shadow-md transition-all hover:shadow-xl dark:border-stone-700 dark:hover:border-white">
      {/* Cover + title ------------------------------------------------------- */}
      <Link href={`/app/site/${data.id}`} className="flex flex-col overflow-hidden rounded-lg">
        <BlurImage
          alt={data.name ?? "Card thumbnail"}
          width={500}
          height={400}
          className="h-44 object-cover"
          src={data.image || DEFAULT_TOOTY_IMAGE}
          placeholder="blur"
          blurDataURL={data.imageBlurhash ?? placeholderBlurhash}
        />
        <div className="border-t border-stone-200 p-4 dark:border-stone-700">
          <h3 className="my-0 truncate font-cal text-xl font-bold tracking-wide dark:text-white">
            {data.name}
          </h3>
          <p className="mt-2 line-clamp-1 text-sm leading-snug text-stone-500 dark:text-stone-400">
            {data.description}
          </p>
        </div>
      </Link>

      {/* Footer actions ------------------------------------------------------ */}
      <div className={`absolute bottom-4 flex w-full px-4 ${hasAnalytics ? "justify-between space-x-4" : "justify-start"}`}>
        {/* Public link */}
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
        >
          {publicLabel} ↗
        </a>

        {/* Analytics link with live share % */}
        {hasAnalytics ? (
          <Link
            href={`/app/site/${data.id}/analytics`}
            className={`flex items-center rounded-md px-2 py-1 text-sm font-medium transition-colors ${
              trend
                ? trend.trend === "up"
                  ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-800/50"
                  : trend.trend === "down"
                    ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-800/50"
                    : "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:hover:bg-yellow-800/50"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            }`}
          >
            <BarChart height={16} className="mr-1" />
            {trend
              ? trend.trend === "up"
                ? `${trend.deltaPct}% ↗`
                : trend.trend === "down"
                  ? `${trend.deltaPct}% ↘`
                  : `${trend.deltaPct}% →`
              : "–"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
