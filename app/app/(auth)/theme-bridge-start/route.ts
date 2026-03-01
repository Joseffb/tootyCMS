import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { createThemeBridgeToken } from "@/lib/theme-auth-bridge";
import { userMeta, users } from "@/lib/schema";
import { getAdminPathAlias } from "@/lib/admin-path";
import {
  deriveThemeBridgeAdminBaseFromReturnUrl,
  isAllowedThemeBridgeReturnUrl,
} from "@/lib/theme-bridge-hosts";

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

function redirectNoStore(to: string | URL, status = 302) {
  const res = NextResponse.redirect(to, status);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnUrl = String(url.searchParams.get("return") || "").trim();
  if (!isAllowedThemeBridgeReturnUrl(returnUrl)) {
    if (process.env.TRACE_PROFILE === "Test") {
      console.info("[trace:Test:theme-bridge-start] invalid return URL", { returnUrl });
    }
    return redirectNoStore(new URL("/", url), 302);
  }
  const appOrigin = deriveThemeBridgeAdminBaseFromReturnUrl(returnUrl, url.origin, getAdminPathAlias());

  const session = await getSession();
  const userId = String(session?.user?.id || "").trim();
  if (!userId) {
    const nestedParams = new URLSearchParams({ return: returnUrl });
    const callbackUrl = `${appOrigin}/theme-bridge-start?${nestedParams.toString()}`;
    const loginParams = new URLSearchParams({ callbackUrl });
    if (process.env.TRACE_PROFILE === "Test") {
      console.info("[trace:Test:theme-bridge-start] unauthenticated, redirecting to login", {
        appOrigin,
        callbackUrl,
      });
    }
    return redirectNoStore(`${appOrigin}/login?${loginParams.toString()}`, 302);
  }

  const { displayName, knownUser } = await resolveBridgeUserProfile(userId);
  const token = await createThemeBridgeToken({
    userId,
    email: String(session?.user?.email || "").trim() || undefined,
    username: String(session?.user?.username || "").trim() || undefined,
    name: String(session?.user?.name || "").trim() || undefined,
    displayName: displayName || undefined,
  });
  if (!token) {
    if (process.env.TRACE_PROFILE === "Test") {
      console.info("[trace:Test:theme-bridge-start] failed to mint token", { userId });
    }
    return redirectNoStore(`${returnUrl}#tootyBridgeAttempted=1`, 302);
  }

  const hashParams = new URLSearchParams({
    tootyBridgeToken: token,
    tootyBridgeAttempted: "1",
    tootyBridgeKnownUser: knownUser ? "1" : "0",
  });
  if (displayName) hashParams.set("tootyBridgeDisplayName", displayName);
  if (process.env.TRACE_PROFILE === "Test") {
    console.info("[trace:Test:theme-bridge-start] authenticated redirect", {
      userId,
      returnUrl,
      hasDisplayName: Boolean(displayName),
    });
  }
  return redirectNoStore(`${returnUrl}#${hashParams.toString()}`, 302);
}
