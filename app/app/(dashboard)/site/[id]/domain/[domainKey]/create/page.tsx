import { getSiteDataDomainByKey } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { resolveAuthorizedSiteForUser } from "@/lib/admin-site-selection";
import { getDomainPostAdminItemPath } from "@/lib/domain-post-admin-routes";
import { unstable_noStore as noStore } from "next/cache";
import { createId } from "@paralleldrive/cuid2";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
};

export default async function CreateDomainEntryPage({ params }: Props) {
  noStore();
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

  const draftId = createId();
  const targetPath = getDomainPostAdminItemPath(effectiveSiteId, resolvedDomainKey, draftId);
  redirect(`${targetPath}?new=1`);
}
