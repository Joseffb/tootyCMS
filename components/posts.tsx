import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import Image from "next/image";
import { redirect } from "next/navigation";
import DomainPostCard from "./domain-post-card";
import { desc, eq } from "drizzle-orm";
import { dataDomains } from "@/lib/schema";

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

  const domain = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, "post"),
    columns: { id: true },
  });
  if (!domain) return null;

  const rows = await db.query.domainPosts.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.userId, session.user.id),
        eq(table.dataDomainId, domain.id),
        siteId ? eq(table.siteId, siteId) : undefined,
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
        <DomainPostCard key={post.id} data={post} siteId={post.siteId || siteId || ""} domainKey="post" />
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
