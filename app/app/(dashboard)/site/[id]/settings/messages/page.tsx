import { renderMessagesPage } from "@/app/app/(dashboard)/settings/messages/page";
import { getAdminPathAlias } from "@/lib/admin-path";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    q?: string;
    status?: string;
    provider?: string;
    offset?: string;
  }>;
};

export default async function SiteMessagesSettingsPage({ params, searchParams }: Props) {
  const adminBasePath = `/app/${getAdminPathAlias()}`;
  const { id } = await params;
  return renderMessagesPage({
    siteId: id,
    searchParams,
    basePath: `${adminBasePath}/site/${id}/settings/messages`,
    denyRedirectPath: `${adminBasePath}/site/${id}`,
    requiredCapability: "site.plugins.manage",
  });
}
