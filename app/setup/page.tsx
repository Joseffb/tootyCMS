import { redirect } from "next/navigation";
import { getInstallState } from "@/lib/install-state";
import SetupWizard from "./setup-wizard";
import { SETUP_ENV_FIELDS, loadSetupEnvValues } from "@/lib/setup-env";

export default async function SetupPage() {
  const state = await getInstallState();

  if (!state.setupRequired) {
    redirect("/");
  }

  const values = await loadSetupEnvValues();
  const statusLabel = state.lifecycleState
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#fef3c7,_#ecfeff_42%,_#fff7ed_100%)]">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-6xl flex-col gap-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-cal text-4xl font-bold text-stone-900">First-Run Setup</h1>
          <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">Setup Status</p>
            <p className="text-xs font-semibold text-sky-900">{statusLabel}</p>
          </div>
        </div>
        <p className="text-stone-700">
          Complete the three setup steps. Values are saved to environment config for this install.
        </p>
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <SetupWizard fields={SETUP_ENV_FIELDS} initialValues={values} />
        </section>
      </div>
    </main>
  );
}
