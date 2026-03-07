import type { BrowserContext } from "@playwright/test";

type SessionCookieInput = {
  value: string;
  origin: string;
  domain?: string;
  expires?: number;
};

function isLocalHost(hostname: string) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

export function buildSessionTokenCookie(input: SessionCookieInput) {
  const origin = String(input.origin || "").trim();
  if (!origin) throw new Error("origin is required to build an auth session cookie.");

  const parsed = new URL(origin);
  const expires = Number.isFinite(input.expires) ? Number(input.expires) : undefined;
  const base = {
    name: "next-auth.session-token",
    value: input.value,
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
    ...(typeof expires === "number" ? { expires } : {}),
  };

  if (isLocalHost(parsed.hostname)) {
    return {
      ...base,
      url: parsed.origin,
    };
  }

  return {
    ...base,
    domain: String(input.domain || parsed.hostname).trim(),
    path: "/",
  };
}

export async function addSessionTokenCookie(context: BrowserContext, input: SessionCookieInput) {
  await context.addCookies([buildSessionTokenCookie(input)]);
}
