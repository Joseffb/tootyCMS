import { getSession } from "@/lib/auth";
import { applyPendingDatabaseMigrations, getDatabaseHealthReport } from "@/lib/db-health";
import { userCan } from "@/lib/authorization";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DatabaseSettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const canManageDb = await userCan("network.settings.write", session.user.id);
  if (!canManageDb) {
    return (
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-700 dark:border-stone-700 dark:bg-black dark:text-stone-300">
        You must be an administrator to manage database updates.
      </div>
    );
  }

  const report = await getDatabaseHealthReport();
  const params = (await searchParams) || {};
  const updated = params.updated === "1";

  async function runDbFixes() {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.settings.write", current.user.id);
    if (!allowed) return;
    await applyPendingDatabaseMigrations();
    revalidatePath("/settings/database");
    revalidatePath("/app");
    redirect("/app/settings/database?updated=1");
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-cal text-2xl">Database Updates</h2>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Schema checks for required CMS columns.
        </p>
      </header>

      {updated ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Database update process completed. Re-checking compatibility below.
        </div>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h3 className="text-lg font-semibold">Compatibility Status</h3>
        <div className="mt-3 grid gap-2 text-sm text-stone-700 dark:text-stone-300 sm:grid-cols-2">
          <p>
            Current Version: <code>{report.currentVersion}</code>
          </p>
          <p>
            Target Version: <code>{report.targetVersion}</code>
          </p>
        </div>
        {report.ok ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
            Database schema is up to date and version-tracked.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              A schema update for for this CMS is required.
            </p>
            {report.pending.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
                {report.pending.map((entry) => (
                  <li key={entry.id}>
                    <span className="font-medium">{entry.title}</span>
                    <span className="text-stone-500 dark:text-stone-400"> - {entry.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {report.missing.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
                {report.missing.map((entry) => (
                  <li key={`${entry.table}.${entry.column}`}>
                    <code>{entry.table}</code>
                    {"."}
                    <code>{entry.column}</code>
                  </li>
                ))}
              </ul>
            ) : null}
            <form action={runDbFixes}>
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-black dark:hover:bg-stone-200"
              >
                Apply Database Update
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
