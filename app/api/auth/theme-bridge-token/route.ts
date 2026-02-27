import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { userMeta, users } from "@/lib/schema";
import { createThemeBridgeToken } from "@/lib/theme-auth-bridge";

async function resolveDisplayName(userId: string) {
  const meta = await db.query.userMeta.findFirst({
    where: and(eq(userMeta.userId, userId), eq(userMeta.key, "display_name")),
    columns: { value: true },
  });
  const fromMeta = String(meta?.value || "").trim();
  if (fromMeta) return fromMeta;
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { username: true, name: true },
  });
  return String(row?.username || row?.name || "").trim();
}

function resolveCorsHeaders(request: Request): Record<string, string> {
  const origin = String(request.headers.get("origin") || "").trim();
  if (!origin) return {};
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
      };
    }
  } catch {
    return {};
  }
  return {};
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
      console.info("[trace:Test:theme-bridge] token request unauthenticated", { mode });
    }
    return NextResponse.json({ ok: true, authenticated: false }, { status: 200, headers: corsHeaders });
  }

  const displayName = await resolveDisplayName(userId);
  const user = {
    id: userId,
    email: String(session?.user?.email || "").trim() || undefined,
    username: String(session?.user?.username || "").trim() || undefined,
    name: String(session?.user?.name || "").trim() || undefined,
    displayName: displayName || String(session?.user?.displayName || "").trim() || undefined,
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
      console.info("[trace:Test:theme-bridge] token request failed to mint", { userId, mode });
    }
    return NextResponse.json({ ok: true, authenticated: false }, { status: 200, headers: corsHeaders });
  }
  if (process.env.TRACE_PROFILE === "Test") {
    console.info("[trace:Test:theme-bridge] token request authenticated", { userId, hasDisplayName: Boolean(user.displayName), mode });
  }
  return NextResponse.json({
    ok: true,
    authenticated: true,
    token,
    user,
  }, { headers: corsHeaders });
}
