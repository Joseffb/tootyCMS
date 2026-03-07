import { createDomainPost, getSiteDataDomainByKey } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { resolveAuthorizedSiteForUser } from "@/lib/admin-site-selection";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
};

export default async function CreateDomainEntryPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id, domainKey } = await params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);

  const { site } = await resolveAuthorizedSiteForUser(session.user.id, siteId, "site.content.create");
  if (!site) notFound();
  const effectiveSiteId = site.id;

  const domain = await getSiteDataDomainByKey(effectiveSiteId, resolvedDomainKey);
  if (!domain) notFound();

  const created = await createDomainPost(null, effectiveSiteId, resolvedDomainKey);
  if ((created as any)?.error || !(created as any)?.id) {
    redirect(
      domain.key === "post"
        ? `/app/site/${effectiveSiteId}`
        : `/app/site/${effectiveSiteId}/domain/${resolvedDomainKey}`,
    );
  }

  redirect(`/app/site/${effectiveSiteId}/domain/${resolvedDomainKey}/post/${(created as any).id}`);
}
