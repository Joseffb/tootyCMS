import Link from "next/link";
import { redirect } from "next/navigation";
import { getInstallState } from "@/lib/install-state";

export default async function SetupPage() {
  const state = await getInstallState();

  if (!state.setupRequired) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col gap-6 p-8">
      <h1 className="font-cal text-4xl font-bold text-stone-900">Tooty CMS First-Run Setup</h1>
      <p className="text-stone-700">
        This install is not initialized yet. Complete setup to create your first admin and main site.
      </p>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">Step 1: Environment</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-stone-700">
          <li><code>POSTGRES_URL</code> (required)</li>
          <li><code>CMS_DB_PREFIX</code> (example: <code>tooty_</code>)</li>
          <li><code>NEXTAUTH_URL</code> and <code>NEXTAUTH_SECRET</code></li>
          <li>At least one OAuth provider key (GitHub, Google, Facebook, Apple)</li>
        </ul>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">Step 2: First Login</h2>
        <p className="mt-2 text-sm text-stone-700">
          First authenticated user becomes administrator automatically.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/app/login" className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white">
            Go to Login
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">Step 3: Verify</h2>
        <p className="mt-2 text-sm text-stone-700">
          After login, open admin settings and confirm site/user defaults.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/app/settings" className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-900">
            Open Admin Settings
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-stone-700">
        SQLite note: current runtime is built around Postgres + Drizzle PG schema. SQLite is not wired yet in this build.
      </section>
    </main>
  );
}
