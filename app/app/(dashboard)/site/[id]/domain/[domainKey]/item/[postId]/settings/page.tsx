import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Form from "@/components/form";
import { getSiteDataDomainByKey, updateDomainPostMetadata } from "@/lib/actions";
import DeleteDomainPostForm from "@/components/form/delete-domain-post-form";
import { canUserMutateDomainPost } from "@/lib/authorization";
import { getSiteDomainPostById } from "@/lib/site-domain-post-store";
import { resolveAuthorizedSiteForAnyCapability } from "@/lib/admin-site-selection";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
    postId: string;
  }>;
};

export default async function DomainPostItemSettings({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id, domainKey, postId } = await params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);
  const resolvedPostId = decodeURIComponent(postId);
  const { site } = await resolveAuthorizedSiteForAnyCapability(session.user.id, siteId, [
    "site.content.read",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.publish",
  ]);
  if (!site) {
    notFound();
  }
  const effectiveSiteId = site.id;

  const domain = await getSiteDataDomainByKey(effectiveSiteId, resolvedDomainKey);
  if (!domain) {
    notFound();
  }

  const data = await getSiteDomainPostById({
    siteId: effectiveSiteId,
    postId: resolvedPostId,
    dataDomainKey: resolvedDomainKey,
  });

  const canEdit = await canUserMutateDomainPost(session.user.id, resolvedPostId, "edit", effectiveSiteId);
  if (!data || !canEdit.allowed) {
    notFound();
  }

  return (
    <div className="flex max-w-screen-xl flex-col space-y-12 p-6">
      <div className="flex flex-col space-y-6">
        <h1 className="font-cal text-3xl font-bold dark:text-white">{domain.label} Settings</h1>
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
          siteId={effectiveSiteId}
          domainKey={resolvedDomainKey}
        />
      </div>
    </div>
  );
}
