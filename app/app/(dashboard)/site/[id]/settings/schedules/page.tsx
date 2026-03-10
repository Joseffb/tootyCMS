import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  createSiteScheduledActionAdmin,
  deleteSiteScheduledActionAdmin,
  getSiteScheduleSettingsAdmin,
  runSiteScheduledActionNowAdmin,
  updateSiteScheduledActionAdmin,
  updateSiteScheduleSettings,
} from "@/lib/actions";
import CreateScheduledActionPanel from "@/app/app/(dashboard)/settings/schedules/create-scheduled-action-panel";
import ScheduledActionRow from "@/app/app/(dashboard)/settings/schedules/scheduled-action-row";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function SiteSchedulesSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const siteId = decodeURIComponent(id);
  const settings = await getSiteScheduleSettingsAdmin(siteId);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Site Schedules</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        These schedules belong only to {settings.site.name || settings.site.subdomain || "this site"}. The central
        network cron dispatches them when site schedules are enabled.
      </p>

      <CreateScheduledActionPanel
        scope="site"
        fixedSite={settings.site}
        actionOptions={settings.actionOptions || []}
        action={createSiteScheduledActionAdmin}
      />

      <div className="mt-8 overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-700 dark:bg-stone-900 dark:text-stone-300">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Every</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Next Run</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {settings.schedules.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-stone-500 dark:text-stone-400" colSpan={7}>
                  No site schedules yet.
                </td>
              </tr>
            ) : (
              settings.schedules.map((entry: any) => (
                <ScheduledActionRow
                  key={entry.id}
                  scope="site"
                  fixedSite={settings.site}
                  entry={entry}
                  actionOptions={settings.actionOptions || []}
                  onUpdate={updateSiteScheduledActionAdmin}
                  onDelete={deleteSiteScheduledActionAdmin}
                  onRunNow={runSiteScheduledActionNowAdmin}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <form
        action={updateSiteScheduleSettings}
        className="mt-8 space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700"
      >
        <input type="hidden" name="siteId" value={settings.site.id} />
        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input type="checkbox" name="schedules_enabled" defaultChecked={settings.enabled} className="h-4 w-4" />
          <span>Enable schedules for this site</span>
        </label>

        <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
          Save Site Schedules
        </button>
      </form>
    </div>
  );
}
