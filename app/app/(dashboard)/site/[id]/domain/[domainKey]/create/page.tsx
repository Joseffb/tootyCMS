import { createDomainPost, getSiteDataDomainByKey } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { canUserCreateDomainContent } from "@/lib/authorization";

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

  const canCreate = await canUserCreateDomainContent(session.user.id, siteId);
  if (!canCreate) notFound();

  const domain = await getSiteDataDomainByKey(siteId, resolvedDomainKey);
  if (!domain) notFound();

  const created = await createDomainPost(null, siteId, resolvedDomainKey);
  if ((created as any)?.error || !(created as any)?.id) {
    redirect(domain.key === "post" ? `/site/${siteId}` : `/site/${siteId}/domain/${resolvedDomainKey}`);
  }

  redirect(`/site/${siteId}/domain/${resolvedDomainKey}/post/${(created as any).id}`);
}
