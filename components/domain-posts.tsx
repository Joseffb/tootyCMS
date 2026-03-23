import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Image from "next/image";
import DomainPostCard from "@/components/domain-post-card";
import DomainPostListTable from "@/components/domain-post-list-table";
import { getSiteDataDomainByKey } from "@/lib/actions";
import { listSiteDomainPosts } from "@/lib/site-domain-post-store";
import { type DomainPostAdminView } from "@/lib/domain-post-admin-view";

export default async function DomainPosts({
  siteId,
  domainKey,
  limit,
  view = "cards",
}: {
  siteId: string;
  domainKey: string;
  limit?: number;
  view?: DomainPostAdminView;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const domain = await getSiteDataDomainByKey(siteId, domainKey);
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: {
      id: true,
      subdomain: true,
      customDomain: true,
      isPrimary: true,
    },
  });

  if (!domain || !site) {
    return null;
  }

  const rows = await listSiteDomainPosts({
    siteId,
    dataDomainKey: domainKey,
    includeInactiveDomains: true,
    ...(limit ? { limit } : {}),
  });

  return rows.length > 0 ? (
    view === "list" ? (
      <DomainPostListTable rows={rows} site={site} siteId={siteId} domainKey={domainKey} />
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((post) => (
          <DomainPostCard key={post.id} data={{ ...post, site }} siteId={siteId} domainKey={domainKey} />
        ))}
      </div>
    )
  ) : (
    <div className="flex flex-col items-center space-x-4">
      <h1 className="font-cal text-4xl">No Entries Yet</h1>
      <Image
        alt="missing post"
        src="https://illustrations.popsy.co/gray/graphic-design.svg"
        width={400}
        height={400}
      />
      <p className="text-lg text-stone-500">
        You do not have any entries in this data domain yet. Create one to get started.
      </p>
    </div>
  );
}
