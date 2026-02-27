import { createHash, timingSafeEqual } from "crypto";

const COOKIE_PREFIX = "tooty_post_pw_";
const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

type CookieWriter = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      secure: boolean;
      path: string;
      maxAge: number;
    },
  ) => void;
};

function getSecret() {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "tooty-dev-post-password-secret";
}

function getCookieName(postId: string) {
  const hash = createHash("sha1").update(postId).digest("hex").slice(0, 20);
  return `${COOKIE_PREFIX}${hash}`;
}

function buildGrant(postId: string, password: string) {
  return createHash("sha256").update(`${postId}:${password}:${getSecret()}`).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function requiresPostPasswordGate(input: { usePassword?: boolean | null; password?: string | null }) {
  return Boolean(input.usePassword) && String(input.password || "").trim().length > 0;
}

export function hasPostPasswordAccess(
  cookies: CookieReader,
  input: { postId: string; password: string | null | undefined },
) {
  const password = String(input.password || "");
  if (!input.postId || !password) return false;
  const cookie = cookies.get(getCookieName(input.postId))?.value || "";
  const expected = buildGrant(input.postId, password);
  return safeEqualHex(cookie, expected);
}

export function grantPostPasswordAccess(
  cookies: CookieWriter,
  input: { postId: string; password: string | null | undefined },
) {
  const password = String(input.password || "");
  if (!input.postId || !password) return;
  cookies.set(getCookieName(input.postId), buildGrant(input.postId, password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });
}
