import { Suspense } from "react";
import Sites from "@/components/sites";
import CreateSiteButton from "@/components/create-site-button";
import CreateSiteModal from "@/components/modal/create-site";
import { getSession } from "@/lib/auth";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import db from "@/lib/db";
import { inArray } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function AllSites() {
  const session = await getSession();
  if (session) {
    const siteIds = await listSiteIdsForUser(session.user.id);
    const memberSites = siteIds.length > 0
      ? await db.query.sites.findMany({
          where: inArray(sites.id, siteIds),
          columns: { id: true, isPrimary: true, subdomain: true },
        })
      : [];
    if (memberSites.length === 1) {
      const primary =
        memberSites.find((site) => site.isPrimary || site.subdomain === "main") || memberSites[0];
      redirect(`/app/site/${primary.id}`);
    }
  }

  return (
    <div className="flex max-w-screen-xl flex-col space-y-12 p-8">
      <div className="flex flex-col space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-cal text-3xl font-bold light:text-black">
            All Sites
          </h1>
          <CreateSiteButton>
            <CreateSiteModal />
          </CreateSiteButton>
        </div>
        <Suspense fallback={null}>
          <Sites />
        </Suspense>
      </div>
    </div>
  );
}
