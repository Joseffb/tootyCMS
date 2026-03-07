import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import Image from "next/image";
import { redirect } from "next/navigation";
import DomainPostCard from "./domain-post-card";
import { eq, inArray } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { listNetworkDomainPosts, listSiteDomainPosts } from "@/lib/site-domain-post-store";

export default async function Posts({
  siteId,
  limit,
}: {
  siteId?: string;
  limit?: number;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const accessibleSiteIds = await listSiteIdsForUser(session.user.id);
  if (!siteId && accessibleSiteIds.length === 0) return null;
  const targetSiteIds = siteId ? [siteId] : accessibleSiteIds;
  const siteRows = await db.query.sites.findMany({
    where: inArray(sites.id, targetSiteIds),
    columns: {
      id: true,
      subdomain: true,
      customDomain: true,
      isPrimary: true,
    },
  });
  const siteById = new Map(siteRows.map((site) => [site.id, site]));

  const rows = siteId
    ? await listSiteDomainPosts({
        siteId,
        dataDomainKey: "post",
        includeInactiveDomains: false,
        ...(limit ? { limit } : {}),
      })
    : await listNetworkDomainPosts({
        siteIds: accessibleSiteIds,
        includeContent: false,
      }).then((entries) => (limit ? entries.slice(0, limit) : entries));

  return rows.length > 0 ? (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((post) => (
        <DomainPostCard
          key={post.id}
          data={{ ...post, site: siteById.get(post.siteId || siteId || "") || null }}
          siteId={post.siteId || siteId || ""}
          domainKey="post"
        />
      ))}
    </div>
  ) : (
    <div className="flex flex-col items-center space-x-4">
      <h1 className="font-cal text-4xl">No Posts Yet</h1>
      <Image
        alt="missing post"
        src="https://illustrations.popsy.co/gray/graphic-design.svg"
        width={400}
        height={400}
      />
      <p className="text-lg text-stone-500">
        You do not have any posts yet. Create one to get started.
      </p>
    </div>
  );
}
