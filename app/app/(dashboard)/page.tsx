import { Suspense } from "react";
import Sites from "@/components/sites";
import OverviewStats from "@/components/overview-stats";
import Posts from "@/components/posts";
import PlaceholderCard from "@/components/placeholder-card";
import OverviewSitesCTA from "@/components/overview-sites-cta";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { redirect } from "next/navigation";

export default async function Overview() {
  const session = await getSession();
  if (session) {
    const ownedSites = await db.query.sites.findMany({
      where: (sites, { eq }) => eq(sites.userId, session.user.id),
      columns: { id: true, isPrimary: true, subdomain: true },
    });
    if (ownedSites.length === 1) {
      const primary =
        ownedSites.find((site) => site.isPrimary || site.subdomain === "main") || ownedSites[0];
      redirect(`/site/${primary.id}`);
    }
  }

  return (
    <div className="flex w-full max-w-none flex-col space-y-12 p-8">
      <div className="flex flex-col space-y-6">
        <h1 className="font-cal text-3xl font-bold light:text-black">
          Overview
        </h1>
        <OverviewStats />
      </div>

      <div className="flex flex-col space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-cal text-3xl font-bold light:text-black">
            Top Sites
          </h1>
          <Suspense fallback={null}>
            <OverviewSitesCTA />
          </Suspense>
        </div>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <PlaceholderCard key={i} />
              ))}
            </div>
          }
        >
          <Sites limit={4} />
        </Suspense>
      </div>

      <div className="flex flex-col space-y-6">
        <h1 className="font-cal text-3xl font-bold light:text-black">
          Recent Posts
        </h1>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <PlaceholderCard key={i} />
              ))}
            </div>
          }
        >
          <Posts limit={8} />
        </Suspense>
      </div>
    </div>
  );
}
