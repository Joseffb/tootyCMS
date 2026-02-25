import ProfileSettingsPanel from "@/components/settings/profile-settings-panel";

type Props = {
  searchParams: Promise<{ forcePasswordChange?: string }>;
};

export default async function ProfileSettingsPage({ searchParams }: Props) {
  const params = await searchParams;
  const forcePasswordChange = params.forcePasswordChange === "1";
  return <ProfileSettingsPanel forcePasswordChange={forcePasswordChange} />;
}
