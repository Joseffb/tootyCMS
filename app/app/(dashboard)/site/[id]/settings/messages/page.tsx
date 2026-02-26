import { renderMessagesPage } from "@/app/app/(dashboard)/settings/messages/page";

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
  const { id } = await params;
  return renderMessagesPage({
    siteId: id,
    searchParams,
    basePath: `/site/${id}/settings/messages`,
    denyRedirectPath: `/app/site/${id}`,
    requiredCapability: "site.plugins.manage",
  });
}
