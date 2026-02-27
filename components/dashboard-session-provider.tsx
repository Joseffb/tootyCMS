"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

export default function DashboardSessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session} basePath="/api/auth" refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}
