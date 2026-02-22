import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { dataDomains } from "@/lib/schema";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Image from "next/image";
import DomainPostCard from "@/components/domain-post-card";

export default async function DomainPosts({
  siteId,
  domainKey,
  limit,
}: {
  siteId: string;
  domainKey: string;
  limit?: number;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const domain = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, domainKey),
    columns: { id: true },
  });

  if (!domain) {
    return null;
  }

  const rows = await db.query.domainPosts.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.userId, session.user.id),
        eq(table.siteId, siteId),
        eq(table.dataDomainId, domain.id),
      ),
    with: {
      site: true,
    },
    orderBy: (table) => desc(table.updatedAt),
    ...(limit ? { limit } : {}),
  });

  return rows.length > 0 ? (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((post) => (
        <DomainPostCard key={post.id} data={post} siteId={siteId} domainKey={domainKey} />
      ))}
    </div>
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
