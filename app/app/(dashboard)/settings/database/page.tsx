import { getSession } from "@/lib/auth";
import { applyDatabaseCompatibilityFixes, getDatabaseHealthReport } from "@/lib/db-health";
import { isAdministrator } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DatabaseSettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  if (!isAdministrator((session.user as any).role)) {
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
    if (!current?.user?.id || !isAdministrator((current.user as any)?.role)) return;
    await applyDatabaseCompatibilityFixes();
    revalidatePath("/settings/database");
    revalidatePath("/app");
    redirect("/settings/database?updated=1");
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-cal text-2xl">Database Updates</h2>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          WordPress-style schema checks for required CMS columns.
        </p>
      </header>

      {updated ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Database update process completed. Re-checking compatibility below.
        </div>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h3 className="text-lg font-semibold">Compatibility Status</h3>
        {report.ok ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">Database schema is up to date.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Database update required. Missing columns detected:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
              {report.missing.map((entry) => (
                <li key={`${entry.table}.${entry.column}`}>
                  <code>{entry.table}</code>
                  {"."}
                  <code>{entry.column}</code>
                </li>
              ))}
            </ul>
            <form action={runDbFixes}>
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-black dark:hover:bg-stone-200"
              >
                Run Database Update
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
