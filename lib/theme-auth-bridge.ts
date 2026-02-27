import { decode, encode } from "next-auth/jwt";

const THEME_BRIDGE_AUDIENCE = "theme-bridge";
const ONE_HOUR_SECONDS = 60 * 60;

export type ThemeBridgeClaims = {
  sub: string;
  email?: string;
  username?: string;
  name?: string;
  displayName?: string;
  aud: string;
};

function getSecret() {
  return String(process.env.NEXTAUTH_SECRET || "").trim();
}

export async function createThemeBridgeToken(input: {
  userId: string;
  email?: string;
  username?: string;
  name?: string;
  displayName?: string;
}) {
  const secret = getSecret();
  if (!secret) return "";
  const userId = String(input.userId || "").trim();
  if (!userId) return "";
  return encode({
    secret,
    maxAge: ONE_HOUR_SECONDS,
    token: {
      sub: userId,
      aud: THEME_BRIDGE_AUDIENCE,
      email: String(input.email || "").trim() || undefined,
      username: String(input.username || "").trim() || undefined,
      name: String(input.name || "").trim() || undefined,
      displayName: String(input.displayName || "").trim() || undefined,
    },
  });
}

export async function verifyThemeBridgeToken(rawToken: string) {
  const secret = getSecret();
  if (!secret) return null;
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const payload = await decode({ token, secret });
  if (!payload) return null;
  if (String(payload.aud || "") !== THEME_BRIDGE_AUDIENCE) return null;
  const sub = String(payload.sub || "").trim();
  if (!sub) return null;
  return {
    sub,
    email: String(payload.email || "").trim() || undefined,
    username: String(payload.username || "").trim() || undefined,
    name: String(payload.name || "").trim() || undefined,
    displayName: String(payload.displayName || "").trim() || undefined,
    aud: THEME_BRIDGE_AUDIENCE,
  } as ThemeBridgeClaims;
}

