import { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import SiteSettingsNav from "./nav";
import db from "@/lib/db";
import { getSitePublicUrl } from "@/lib/site-url";

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
  const data = await db.query.sites.findFirst({
    where: (sites, { eq }) => eq(sites.id, decodeURIComponent(id)),
  });

  if (!data || data.userId !== session.user.id) {
    notFound();
  }

  const url = `${data.subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;

  return (
    <>
      <div className="flex flex-col items-center space-x-4 space-y-2 sm:flex-row sm:space-y-0">
        <h1 className="font-cal text-xl font-bold sm:text-3xl light:text-black">
          Settings for {data.name}
        </h1>
        <a
          href={
            process.env.NEXT_PUBLIC_VERCEL_ENV
              ? `https://${url}`
              : getSitePublicUrl({ subdomain: data.subdomain, customDomain: data.customDomain, isPrimary: data.subdomain === "main" })
          }
          target="_blank"
          rel="noreferrer"
          className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
        >
          {url} ↗
        </a>
      </div>
      <SiteSettingsNav />
      {/* This renders the children passed to this layout */}
      {children}
    </>
  );
}