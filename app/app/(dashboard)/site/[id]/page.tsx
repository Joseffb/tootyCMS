import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Posts from "@/components/posts";
import CreatePostButton from "@/components/create-post-button";
import db from "@/lib/db";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSetting } from "@/lib/cms-config";
type Props = {
  params: Promise<{
    id: string
  }>
}
export default async function SitePosts({ params }: Props) {
  const id = (await params).id;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const data = await db.query.sites.findFirst({
    where: (sites, { eq }) => eq(sites.id, decodeURIComponent(id)),
  });

  if (!data || data.userId !== session.user.id) {
    notFound();
  }

  const isPrimary = data.isPrimary || data.subdomain === "main";
  const derivedUrl = getSitePublicUrl({
    subdomain: data.subdomain,
    customDomain: data.customDomain,
    isPrimary,
  });
  const derivedHost = getSitePublicHost({
    subdomain: data.subdomain,
    customDomain: data.customDomain,
    isPrimary,
  });
  const configuredSiteUrl = isPrimary ? (await getSiteUrlSetting()).value.trim() : "";
  const publicUrl = configuredSiteUrl || derivedUrl;
  const publicHost = configuredSiteUrl
    ? (() => {
        try {
          return new URL(configuredSiteUrl).host;
        } catch {
          return configuredSiteUrl.replace(/^https?:\/\//, "");
        }
      })()
    : derivedHost;

  return (
    <>
      <div className="flex flex-col items-center justify-between space-y-4 sm:flex-row sm:space-y-0">
        <div className="flex flex-col items-center space-y-2 sm:flex-row sm:space-x-4 sm:space-y-0">
          <h1 className="w-60 truncate font-cal text-xl font-bold sm:w-auto sm:text-3xl dark:text-white">
            All Posts for {data.name}
          </h1>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            {publicHost} ↗
          </a>
        </div>
        <CreatePostButton />
      </div>
      <Posts siteId={decodeURIComponent(id)} />
    </>
  );
}
