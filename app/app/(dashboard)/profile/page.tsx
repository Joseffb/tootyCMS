import ProfileSettingsPanel from "@/components/settings/profile-settings-panel";

type Props = {
  searchParams: Promise<{ forcePasswordChange?: string }>;
};

export default async function DashboardProfilePage({ searchParams }: Props) {
  const params = await searchParams;
  const forcePasswordChange = params.forcePasswordChange === "1";
  return (
    <div className="flex max-w-screen-xl flex-col space-y-8 p-8">
      <h1 className="font-cal text-3xl font-bold dark:text-white">Profile</h1>
      <ProfileSettingsPanel forcePasswordChange={forcePasswordChange} />
    </div>
  );
}
