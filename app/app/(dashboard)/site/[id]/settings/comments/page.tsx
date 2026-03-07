import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { resolveAuthorizedSiteForUser } from "@/lib/admin-site-selection";
import SiteCommentsPanel from "@/components/settings/site-comments-panel";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteCommentsSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const siteId = decodeURIComponent(id);
  const { site: allowedSite } = await resolveAuthorizedSiteForUser(
    session.user.id,
    siteId,
    "site.settings.write",
  );
  if (!allowedSite) {
    notFound();
  }

  return <SiteCommentsPanel siteId={allowedSite.id} />;
}
