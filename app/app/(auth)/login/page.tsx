import LoginButton from "./login-button";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getInstallState } from "@/lib/install-state";
import { getSession } from "@/lib/auth";
import { getAdminPathAlias } from "@/lib/admin-path";

export default async function LoginPage() {
  const state = await getInstallState();
  if (state.setupRequired) {
    redirect("/setup");
  }

  const session = await getSession();
  if (session?.user?.id) {
    redirect(`/app/${getAdminPathAlias()}/sites`);
  }

  return (
      <>

    <div className="mx-5 border border-stone-200 py-10 sm:mx-auto sm:w-full sm:max-w-md sm:rounded-lg sm:shadow-md dark:border-stone-700">

      <div className="mx-auto w-11/12 max-w-xs sm:w-full">
        <Suspense
          fallback={
            <div className="my-2 h-10 w-full rounded-md border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800" />
          }
        >
          <LoginButton />
        </Suspense>
      </div>
    </div></>
  );
}
