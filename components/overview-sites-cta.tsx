import { getSession } from "@/lib/auth";
import CreateSiteButton from "./create-site-button";
import CreateSiteModal from "./modal/create-site";
import Link from "next/link";
import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { count, inArray } from "drizzle-orm";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { userCan } from "@/lib/authorization";

export default async function OverviewSitesCTA() {
  const session = await getSession();
  if (!session) {
    return 0;
  }
  const canManageNetworkSites = await userCan("network.site.manage", session.user.id);
  const accessibleSiteIds = canManageNetworkSites ? [] : await listSiteIdsForUser(session.user.id);
  const [sitesResult] = await db
    .select({ count: count() })
    .from(sites)
    .where(
      canManageNetworkSites
        ? undefined
        : accessibleSiteIds.length
          ? inArray(sites.id, accessibleSiteIds)
          : inArray(sites.id, ["__none__"]),
    );

  return sitesResult.count > 0 ? (
    <Link
      href="/app/sites"
      className="rounded-lg border border-black bg-black px-4 py-1.5 text-sm font-medium text-white transition-all hover:bg-white hover:text-black active:bg-stone-100 dark:border-stone-700 dark:hover:border-stone-200 dark:hover:bg-black dark:hover:text-white dark:active:bg-stone-800"
    >
      View All Sites
    </Link>
  ) : (
    <CreateSiteButton>
      <CreateSiteModal />
    </CreateSiteButton>
  );
}
