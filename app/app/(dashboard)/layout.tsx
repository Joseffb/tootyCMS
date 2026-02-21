import { ReactNode, Suspense } from "react";
import Profile from "@/components/profile";
import Nav from "@/components/nav";
import { ensureMainSiteForCurrentUser } from "@/lib/bootstrap";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await ensureMainSiteForCurrentUser();
  return (
    <div className="tooty-admin min-h-screen bg-[radial-gradient(circle_at_top_right,_#fef3c7,_#ecfeff_42%,_#fff7ed_100%)] text-stone-900">
      <Nav>
        <Suspense fallback={<div>Loading...</div>}>
          <Profile />
        </Suspense>
      </Nav>
      <div className="min-h-screen sm:pl-60">{children}</div>
    </div>
  );
}
