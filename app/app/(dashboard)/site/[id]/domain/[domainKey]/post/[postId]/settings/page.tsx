import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Form from "@/components/form";
import { getSiteDataDomainByKey, updateDomainPostMetadata } from "@/lib/actions";
import DeleteDomainPostForm from "@/components/form/delete-domain-post-form";
import db from "@/lib/db";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
    postId: string;
  }>;
};

export default async function DomainPostSettings({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id, domainKey, postId } = await params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);
  const resolvedPostId = decodeURIComponent(postId);

  const domain = await getSiteDataDomainByKey(siteId, resolvedDomainKey);
  if (!domain) {
    notFound();
  }

  const data = await db.query.domainPosts.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, resolvedPostId),
        eq(table.siteId, siteId),
        eq(table.dataDomainId, domain.id),
      ),
  });

  if (!data || data.userId !== session.user.id) {
    notFound();
  }

  return (
    <div className="flex max-w-screen-xl flex-col space-y-12 p-6">
      <div className="flex flex-col space-y-6">
        <h1 className="font-cal text-3xl font-bold dark:text-white">
          {domain.label} Settings
        </h1>
        <Form
          title="Entry Slug"
          description="The slug is the URL-friendly version of the name. It is usually all lowercase and contains only letters, numbers, and hyphens."
          helpText="Please use a slug that is unique to this entry."
          inputAttrs={{
            name: "slug",
            type: "text",
            defaultValue: data.slug,
            placeholder: "slug",
          }}
          handleSubmit={updateDomainPostMetadata}
        />

        <DeleteDomainPostForm
          postName={Promise.resolve({ postName: data.title || "Untitled" })}
          siteId={siteId}
          domainKey={resolvedDomainKey}
        />
      </div>
    </div>
  );
}
