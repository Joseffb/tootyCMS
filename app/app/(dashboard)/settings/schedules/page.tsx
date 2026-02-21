import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getScheduleSettingsAdmin, updateScheduleSettings } from "@/lib/actions";

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

      <form action={updateScheduleSettings} className="mt-4 space-y-3">
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
          Save Schedule Settings
        </button>
      </form>
    </div>
  );
}
