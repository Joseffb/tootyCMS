import { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import GlobalSettingsNav from "./nav";
import { userCan } from "@/lib/authorization";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const canManageNetworkSettings = await userCan("network.settings.write", session.user.id);
  if (!canManageNetworkSettings) {
    redirect("/app");
  }

  return (
    <div className="flex max-w-screen-xl flex-col space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="font-cal text-3xl font-bold dark:text-white">Settings</h1>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Global CMS configuration for themes, plugins, RBAC, users, reading, writing, and schedules.
        </p>
      </div>
      <GlobalSettingsNav />
      {children}
    </div>
  );
}
