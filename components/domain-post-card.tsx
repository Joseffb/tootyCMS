import BlurImage from "@/components/blur-image";
import type { SelectSite } from "@/lib/schema";
import { placeholderBlurhash } from "@/lib/utils";
import { getSitePublicUrl } from "@/lib/site-url";
import Link from "next/link";
import { DEFAULT_TOOTY_IMAGE } from "@/lib/tooty-images";

type DomainPostCardData = {
  id: string;
  title: string | null;
  description: string | null;
  slug: string;
  image: string | null;
  imageBlurhash: string | null;
  published: boolean;
  site?: SelectSite | null;
};

export default function DomainPostCard({
  data,
  siteId,
  domainKey,
}: {
  data: DomainPostCardData;
  siteId: string;
  domainKey: string;
}) {
  const baseUrl = getSitePublicUrl({
    subdomain: data.site?.subdomain,
    customDomain: data.site?.customDomain,
    isPrimary: data.site?.isPrimary || data.site?.subdomain === "main",
  });
  const postUrl = `${baseUrl.replace(/\/$/, "")}/${domainKey}/${data.slug}`;
  const urlLabel = postUrl.replace(/^https?:\/\//, "");

  return (
    <div className="relative rounded-lg border border-stone-200 pb-10 shadow-md transition-all hover:shadow-xl dark:border-stone-700 dark:hover:border-white">
      <Link
        href={`/site/${siteId}/domain/${domainKey}/post/${data.id}`}
        className="flex flex-col overflow-hidden rounded-lg"
      >
        <div className="relative h-44 overflow-hidden">
          <BlurImage
            alt={data.title ?? "Card thumbnail"}
            width={500}
            height={400}
            className="h-full object-cover"
            src={data.image || DEFAULT_TOOTY_IMAGE}
            placeholder="blur"
            blurDataURL={data.imageBlurhash ?? placeholderBlurhash}
          />
          {!data.published && (
            <span className="absolute bottom-2 right-2 rounded-md border border-stone-200 bg-white px-3 py-0.5 text-sm font-medium text-stone-600 shadow-md">
              Draft
            </span>
          )}
        </div>
        <div className="border-t border-stone-200 p-4 dark:border-stone-700">
          <h3 className="my-0 truncate font-cal text-xl font-bold tracking-wide light:text-black">
            {data.title || "Untitled"}
          </h3>
          <p className="mt-2 line-clamp-1 text-sm font-normal leading-snug text-stone-500 dark:text-stone-400">
            {data.description || "No description yet"}
          </p>
        </div>
      </Link>
      <div className="absolute bottom-4 flex w-full px-4">
        <a
          href={postUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
        >
          {urlLabel} ↗
        </a>
      </div>
    </div>
  );
}
