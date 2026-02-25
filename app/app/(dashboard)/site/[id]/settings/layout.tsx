import { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import SiteSettingsNav from "./nav";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSettingForSite } from "@/lib/cms-config";
import { getAuthorizedSiteForUser } from "@/lib/authorization";

type Props = {
  params: Promise<{
    id: string;
  }>;
  children: ReactNode; // Destructure children properly from props
};

export default async function SiteAnalyticsLayout({ params, children }: Props) {
  const id = (await params).id;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const data = await getAuthorizedSiteForUser(session.user.id, decodeURIComponent(id), "site.settings.write");
  if (!data) {
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
  const configuredSiteUrl = (await getSiteUrlSettingForSite(data.id, "")).value.trim();
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
      <div className="flex flex-col items-center space-x-4 space-y-2 sm:flex-row sm:space-y-0">
        <h1 className="font-cal text-xl font-bold sm:text-3xl light:text-black">
          Settings for {data.name}
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
      <SiteSettingsNav />
      {/* This renders the children passed to this layout */}
      {children}
    </>
  );
}
