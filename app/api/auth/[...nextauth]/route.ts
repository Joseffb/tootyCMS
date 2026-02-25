import { getAuthOptions } from "@/lib/auth";
import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

async function handler(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  const authOptions = await getAuthOptions();
  return NextAuth(authOptions)(req, { params: await context.params });
}

export { handler as GET, handler as POST };
