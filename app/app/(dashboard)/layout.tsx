import { ReactNode, Suspense } from "react";
import Profile from "@/components/profile";
import Nav from "@/components/nav";
import { ensureMainSiteForCurrentUser } from "@/lib/bootstrap";
import Link from "next/link";
import { getDatabaseHealthReport } from "@/lib/db-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await ensureMainSiteForCurrentUser();
  const dbHealth = await getDatabaseHealthReport();
  return (
    <div className="tooty-admin min-h-screen bg-[radial-gradient(circle_at_top_right,_#fef3c7,_#ecfeff_42%,_#fff7ed_100%)] text-stone-900">
      <Nav>
        <Suspense fallback={<div>Loading...</div>}>
          <Profile />
        </Suspense>
      </Nav>
      <div className="min-h-screen sm:pl-60">
        {!dbHealth.ok ? (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-900">
            Database update required. Some columns are missing.
            {" "}
            <Link href="/settings/database" className="font-semibold underline">
              Open Database Updates
            </Link>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
