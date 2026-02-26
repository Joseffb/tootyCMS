import { ReactNode, Suspense } from "react";
import Profile from "@/components/profile";
import Nav from "@/components/nav";
import { ensureMainSiteForCurrentUser } from "@/lib/bootstrap";
import Link from "next/link";
import { getDatabaseHealthReport } from "@/lib/db-health";
import { getInstallState } from "@/lib/install-state";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { stopUserMimic } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const installState = await getInstallState();
  if (installState.setupRequired) {
    redirect("/setup");
  }
  await ensureMainSiteForCurrentUser();
  const session = await getSession();
  const dbHealth = await getDatabaseHealthReport();
  return (
    <div className="tooty-admin min-h-screen bg-[radial-gradient(circle_at_top_right,_#fef3c7,_#ecfeff_42%,_#fff7ed_100%)] text-stone-900">
      <Nav>
        <Suspense fallback={<div>Loading...</div>}>
          <Profile />
        </Suspense>
      </Nav>
      <div className="min-h-screen sm:pl-60">
        {(session?.user as any)?.mimicActorId ? (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-900">
            Mimicking `{session?.user?.email}`.
            {" "}
            <form
              action={async () => {
                "use server";
                await stopUserMimic();
                redirect("/app/settings/users");
              }}
              className="inline"
            >
              <button className="font-semibold underline">Return to your account</button>
            </form>
          </div>
        ) : null}
        {!dbHealth.ok ? (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-900">
            A schema update for for this CMS is required.
            {" "}
            <Link href="/settings/database" className="font-semibold">
              Open Database Updates
            </Link>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
