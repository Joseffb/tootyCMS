import { redirect } from "next/navigation";
import { getInstallState } from "@/lib/install-state";
import SetupWizard from "./setup-wizard";
import { SETUP_ENV_FIELDS, loadSetupEnvValues } from "@/lib/setup-env";

export default async function SetupPage() {
  const state = await getInstallState();

  if (!state.setupRequired) {
    redirect("/app");
  }

  const values = await loadSetupEnvValues();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#fef3c7,_#ecfeff_42%,_#fff7ed_100%)]">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-6xl flex-col gap-6 p-8">
        <h1 className="font-cal text-4xl font-bold text-stone-900">First-Run Setup</h1>
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
