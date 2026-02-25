import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  createScheduledActionAdmin,
  deleteScheduledActionAdmin,
  getScheduleSettingsAdmin,
  runScheduledActionNowAdmin,
  updateScheduledActionAdmin,
  updateScheduleSettings,
} from "@/lib/actions";
import CreateScheduledActionPanel from "./create-scheduled-action-panel";
import ScheduledActionRow from "./scheduled-action-row";

export default async function SchedulesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await getScheduleSettingsAdmin();

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Schedules</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Cron-like controls for deploy-time automation. Use Vercel Cron for execution.
      </p>

      <CreateScheduledActionPanel
        sites={settings.sites}
        actionOptions={settings.actionOptions || []}
        action={createScheduledActionAdmin}
      />

      <div className="mt-8 overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-700 dark:bg-stone-900 dark:text-stone-300">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Site</th>
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
                <td className="px-3 py-3 text-stone-500 dark:text-stone-400" colSpan={8}>
                  No scheduled actions yet.
                </td>
              </tr>
            ) : (
              settings.schedules.map((entry: any) => (
                <ScheduledActionRow
                  key={entry.id}
                  entry={entry}
                  sites={settings.sites}
                  actionOptions={settings.actionOptions || []}
                  onUpdate={updateScheduledActionAdmin}
                  onDelete={deleteScheduledActionAdmin}
                  onRunNow={runScheduledActionNowAdmin}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <form action={updateScheduleSettings} className="mt-8 space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700">
        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input type="checkbox" name="schedules_enabled" defaultChecked={settings.enabled} className="h-4 w-4" />
          <span>Enable schedules</span>
        </label>

        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input
            type="checkbox"
            name="schedules_ping_sitemap"
            defaultChecked={settings.pingSitemap}
            className="h-4 w-4"
          />
          <span>Ping sitemap endpoint on schedule run</span>
        </label>

        <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
          Save Schedules
        </button>
      </form>
    </div>
  );
}
