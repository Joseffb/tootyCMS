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

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-6xl flex-col gap-6 p-8">
      <h1 className="font-cal text-4xl font-bold text-stone-900">First-Run Setup</h1>
      <p className="text-stone-700">
        Enter your environment values below. These are written to <code>.env</code> on this machine.
      </p>
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <SetupWizard fields={SETUP_ENV_FIELDS} initialValues={values} />
      </section>
    </main>
  );
}
