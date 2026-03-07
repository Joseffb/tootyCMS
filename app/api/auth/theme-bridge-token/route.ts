import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { userMeta, users } from "@/lib/schema";
import { createThemeBridgeToken } from "@/lib/theme-auth-bridge";
import { isAllowedThemeBridgeOrigin } from "@/lib/theme-bridge-hosts";
import { traceInfo } from "@/lib/debug";

async function resolveBridgeUserProfile(userId: string) {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, username: true, name: true },
  });
  const meta = await db.query.userMeta.findFirst({
    where: and(eq(userMeta.userId, userId), eq(userMeta.key, "display_name")),
    columns: { value: true },
  });
  const fromMeta = String(meta?.value || "").trim();
  return {
    knownUser: Boolean(String(row?.id || "").trim()),
    displayName: fromMeta || String(row?.username || row?.name || "").trim(),
  };
}

function resolveCorsHeaders(request: Request): Record<string, string> {
  const origin = String(request.headers.get("origin") || "").trim();
  if (!origin) return {};
  if (!isAllowedThemeBridgeOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  const corsHeaders = resolveCorsHeaders(request);
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}

export async function GET(request: Request) {
  const corsHeaders = resolveCorsHeaders(request);
  const requestUrl = new URL(request.url);
  const mode = String(requestUrl.searchParams.get("mode") || "silent").trim().toLowerCase();
  const session = await getSession();
  const userId = String(session?.user?.id || "").trim();
  if (!userId) {
    if (process.env.TRACE_PROFILE === "Test") {
      traceInfo("theme-bridge", "token request unauthenticated", { mode });
    }
    return NextResponse.json({ ok: true, authenticated: false }, { status: 200, headers: corsHeaders });
  }

  const { displayName, knownUser } = await resolveBridgeUserProfile(userId);
  const user = {
    id: userId,
    email: String(session?.user?.email || "").trim() || undefined,
    username: String(session?.user?.username || "").trim() || undefined,
    name: String(session?.user?.name || "").trim() || undefined,
    displayName: displayName || String(session?.user?.displayName || "").trim() || undefined,
    knownUser,
  };
  const token = await createThemeBridgeToken({
    userId: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    displayName: user.displayName,
  });
  if (!token) {
    if (process.env.TRACE_PROFILE === "Test") {
      traceInfo("theme-bridge", "token request failed to mint", { userId, mode });
    }
    return NextResponse.json({ ok: true, authenticated: false }, { status: 200, headers: corsHeaders });
  }
  if (process.env.TRACE_PROFILE === "Test") {
    traceInfo("theme-bridge", "token request authenticated", { userId, hasDisplayName: Boolean(user.displayName), mode });
  }
  return NextResponse.json({
    ok: true,
    authenticated: true,
    token,
    user,
  }, { headers: corsHeaders });
}
