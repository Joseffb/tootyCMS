import BlurImage from "@/components/blur-image";
import type { SelectSite } from "@/lib/schema";
import { placeholderBlurhash } from "@/lib/utils";
import { BarChart } from "lucide-react";
import Link from "next/link";
import { getSitePublicUrl } from "@/lib/site-url";
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
      : `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}${path}`;
}

/** Call our `/api/tb-pipe` proxy to fetch the domain's traffic share. */
async function getDomainShare(domain: string): Promise<number | null> {
  try {
    const qs  = new URLSearchParams({ name: "domain_share", domain }).toString();
    const res = await fetch(apiUrl(`/api/tb-pipe?${qs}`), {
      // cache for 60 s on the server to avoid hammering Tinybird
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error("[tb-pipe domain_share]", domain, await res.text());
      return null;
    }

    const json = await res.json();
    return json.data?.[0]?.pct_hits ?? null;
  } catch (err) {
    console.error("[tb-pipe domain_share] fetch failed", err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default async function SiteCard({
  data,
  rootUrl,
}: {
  data: SelectSite;
  rootUrl?: string;
}) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
  const rootDomainHost = rootDomain.replace(/:\d+$/, "");
  const isMainSite = data.subdomain === "main";
  const domain = isMainSite ? rootDomain : `${data.subdomain}.${rootDomain}`;
  const analyticsDomain = isMainSite ? rootDomainHost : `${data.subdomain}.${rootDomainHost}`;
  const share = await getDomainShare(analyticsDomain); // e.g. 32.5 → 32.5 %

  let publicUrl = getSitePublicUrl({
    subdomain: data.subdomain,
    customDomain: data.customDomain,
    isPrimary: isMainSite,
  });
  let publicLabel = domain;

  if (rootUrl) {
    publicUrl = rootUrl;
    try {
      publicLabel = new URL(rootUrl).host;
    } catch {
      publicLabel = rootUrl.replace(/^https?:\/\//, "");
    }
  }

  return (
    <div className="relative rounded-lg border border-stone-200 pb-10 shadow-md transition-all hover:shadow-xl dark:border-stone-700 dark:hover:border-white">
      {/* Cover + title ------------------------------------------------------- */}
      <Link href={`/site/${data.id}`} className="flex flex-col overflow-hidden rounded-lg">
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
      <div className="absolute bottom-4 flex w-full justify-between space-x-4 px-4">
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
        <Link
          href={`/site/${data.id}/analytics`}
          className="flex items-center rounded-md bg-green-100 px-2 py-1 text-sm font-medium text-green-600 transition-colors hover:bg-green-200 dark:bg-green-900 dark:bg-opacity-50 dark:text-green-400 dark:hover:bg-green-800 dark:hover:bg-opacity-50"
        >
          <BarChart height={16} className="mr-1" />
          {share !== null ? `${share}%` : "–"}
        </Link>
      </div>
    </div>
  );
}
