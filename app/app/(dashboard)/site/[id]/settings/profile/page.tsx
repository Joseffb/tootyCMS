import ProfileSettingsPanel from "@/components/settings/profile-settings-panel";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ forcePasswordChange?: string }>;
};

export default async function SiteProfileSettingsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const forcePasswordChange = query.forcePasswordChange === "1";
  return <ProfileSettingsPanel siteId={id} forcePasswordChange={forcePasswordChange} />;
}
