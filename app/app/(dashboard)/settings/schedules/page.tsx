import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  createScheduledActionAdmin,
  deleteScheduledActionAdmin,
  getScheduleSettingsAdmin,
  updateScheduledActionAdmin,
  updateScheduleSettings,
} from "@/lib/actions";
import CreateScheduledActionPanel from "./create-scheduled-action-panel";

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

      <CreateScheduledActionPanel sites={settings.sites} action={createScheduledActionAdmin} />

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
                <tr key={entry.id} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="px-3 py-3 align-top text-xs">{entry.name}</td>
                  <td className="px-3 py-3 align-top text-xs">{entry.site?.name || entry.site?.subdomain || "Global"}</td>
                  <td className="px-3 py-3 align-top text-xs">
                    {entry.ownerType}:{entry.ownerId}
                  </td>
                  <td className="px-3 py-3 align-top text-xs font-mono">{entry.actionKey}</td>
                  <td className="px-3 py-3 align-top text-xs">{entry.runEveryMinutes}m</td>
                  <td className="px-3 py-3 align-top text-xs">
                    <div>{entry.lastStatus || "pending"}</div>
                    {entry.lastError ? <div className="mt-1 text-red-600">{entry.lastError}</div> : null}
                  </td>
                  <td className="px-3 py-3 align-top text-xs">
                    {entry.nextRunAt ? new Date(entry.nextRunAt).toLocaleString() : "n/a"}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <form action={updateScheduledActionAdmin} className="space-y-2">
                      <input type="hidden" name="id" value={entry.id} />
                      <input
                        name="name"
                        defaultValue={entry.name}
                        className="w-40 rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                      />
                      <select
                        name="siteId"
                        defaultValue={entry.siteId || ""}
                        className="w-40 rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                      >
                        <option value="">(global)</option>
                        {settings.sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name || site.id}
                          </option>
                        ))}
                      </select>
                      <input
                        name="actionKey"
                        defaultValue={entry.actionKey}
                        className="w-44 rounded border border-stone-300 px-2 py-1 font-mono text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                      />
                      <input
                        type="number"
                        min={1}
                        name="runEveryMinutes"
                        defaultValue={entry.runEveryMinutes}
                        className="w-20 rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                      />
                      <textarea
                        name="payload"
                        defaultValue={JSON.stringify(entry.payload || {}, null, 0)}
                        className="h-16 w-56 rounded border border-stone-300 px-2 py-1 font-mono text-[11px] dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                      />
                      <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
                        <input type="checkbox" name="enabled" defaultChecked={entry.enabled} className="h-4 w-4" />
                        Enabled
                      </label>
                      <div className="flex gap-2">
                        <button className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600">Save</button>
                      </div>
                    </form>
                    <form action={deleteScheduledActionAdmin}>
                      <input type="hidden" name="id" value={entry.id} />
                      <button className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 dark:border-red-700 dark:text-red-300">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
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
