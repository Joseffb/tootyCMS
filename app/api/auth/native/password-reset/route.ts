import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import db from "@/lib/db";
import { users } from "@/lib/schema";
import { hashPassword } from "@/lib/password";
import { getUserMetaValue, setUserMetaValue } from "@/lib/user-meta";
import { sendCommunication } from "@/lib/communications";

type RequestBody = {
  action?: "request" | "reset";
  email?: string;
  code?: string;
  password?: string;
};

type ResetMeta = {
  codeHash?: string;
  expiresAt?: string;
  failedAttempts?: number;
  lockedUntil?: string | null;
  lastRequestedAt?: string;
};

const RESET_META_KEY = "native_password_reset_code";
const RESET_REQUEST_IP_LIMIT = 10;
const RESET_REQUEST_IP_WINDOW_MS = 10 * 60_000;
const RESET_APPLY_IP_LIMIT = 30;
const RESET_APPLY_IP_WINDOW_MS = 15 * 60_000;
const resetThrottleByKey = new Map<string, { count: number; resetAt: number }>();

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCode(value: unknown) {
  return String(value || "").trim();
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function issueCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function extractClientIp(request: Request) {
  const forwardedFor = String(
    request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("cf-connecting-ip") ||
      "",
  ).trim();
  if (!forwardedFor) return "";
  return String(forwardedFor.split(",")[0] || "").trim();
}

function enforceIpThrottle(key: string, limit: number, windowMs: number) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return { allowed: true as const, retryAfterMs: 0 };

  const now = Date.now();
  for (const [entryKey, entry] of resetThrottleByKey.entries()) {
    if (entry.resetAt <= now) {
      resetThrottleByKey.delete(entryKey);
    }
  }

  const current = resetThrottleByKey.get(normalizedKey);
  const next =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
  resetThrottleByKey.set(normalizedKey, next);
  if (next.count <= limit) {
    return { allowed: true as const, retryAfterMs: 0 };
  }
  return { allowed: false as const, retryAfterMs: Math.max(0, next.resetAt - now) };
}

function genericRequestMessage() {
  return NextResponse.json({
    ok: true,
    message: "If the account is eligible, a reset code has been sent.",
  });
}

async function requestReset(email: string) {
  if (!email) return genericRequestMessage();
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, email: true, passwordHash: true },
  });
  if (!user?.id || !user.passwordHash) {
    return genericRequestMessage();
  }

  const currentRaw = await getUserMetaValue(user.id, RESET_META_KEY);
  let current: ResetMeta = {};
  try {
    current = currentRaw ? (JSON.parse(currentRaw) as ResetMeta) : {};
  } catch {
    current = {};
  }

  const now = Date.now();
  const lockedUntilTs = Date.parse(String(current.lockedUntil || ""));
  if (Number.isFinite(lockedUntilTs) && lockedUntilTs > now) {
    return NextResponse.json(
      { ok: false, error: "Password reset is temporarily locked. Try again later." },
      { status: 423 },
    );
  }

  const lastRequestedAtTs = Date.parse(String(current.lastRequestedAt || ""));
  if (Number.isFinite(lastRequestedAtTs) && now - lastRequestedAtTs < 60_000) {
    return NextResponse.json(
      { ok: false, error: "Please wait before requesting another reset code." },
      { status: 429 },
    );
  }

  const code = issueCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const next: ResetMeta = {
    codeHash: hashCode(code),
    expiresAt,
    failedAttempts: 0,
    lockedUntil: null,
    lastRequestedAt: new Date().toISOString(),
  };
  await setUserMetaValue(user.id, RESET_META_KEY, JSON.stringify(next));

  await sendCommunication(
    {
      siteId: null,
      channel: "email",
      to: user.email,
      subject: "[Tooty] Password reset code",
      body:
        `A native password reset was requested.\n` +
        `Code: ${code}\n` +
        `Expires: ${expiresAt}\n` +
        `If this wasn't you, ignore this message.`,
      category: "transactional",
      metadata: {
        kind: "native_password_reset",
      },
    },
    { createdByUserId: user.id },
  );

  return genericRequestMessage();
}

async function applyReset(email: string, code: string, password: string) {
  if (!email || !code || !password) {
    return NextResponse.json({ ok: false, error: "Email, code, and new password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, email: true, passwordHash: true },
  });
  if (!user?.id || !user.passwordHash) {
    return NextResponse.json({ ok: false, error: "Invalid code or email." }, { status: 400 });
  }

  const raw = await getUserMetaValue(user.id, RESET_META_KEY);
  let meta: ResetMeta = {};
  try {
    meta = raw ? (JSON.parse(raw) as ResetMeta) : {};
  } catch {
    meta = {};
  }

  const now = Date.now();
  const lockedUntilTs = Date.parse(String(meta.lockedUntil || ""));
  if (Number.isFinite(lockedUntilTs) && lockedUntilTs > now) {
    return NextResponse.json(
      { ok: false, error: "Password reset is temporarily locked. Try again later." },
      { status: 423 },
    );
  }

  const expiresAtTs = Date.parse(String(meta.expiresAt || ""));
  if (!meta.codeHash || !Number.isFinite(expiresAtTs) || expiresAtTs <= now) {
    return NextResponse.json({ ok: false, error: "Reset code expired. Request a new code." }, { status: 400 });
  }

  const incomingHash = hashCode(code);
  if (incomingHash !== String(meta.codeHash)) {
    const failedAttempts = Math.max(0, Number(meta.failedAttempts || 0)) + 1;
    const shouldLock = failedAttempts >= 5;
    const lockedUntil = shouldLock ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await setUserMetaValue(
      user.id,
      RESET_META_KEY,
      JSON.stringify({
        ...meta,
        failedAttempts,
        lockedUntil,
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid reset code.",
        attemptsRemaining: Math.max(0, 5 - failedAttempts),
        lockedUntil,
      },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash, authProvider: "native", updatedAt: new Date() })
    .where(and(eq(users.id, user.id), eq(users.email, user.email)));
  await setUserMetaValue(user.id, RESET_META_KEY, "");

  return NextResponse.json({
    ok: true,
    message: "Password reset successful. You can now log in.",
  });
}

export async function POST(request: Request) {
  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = String(body.action || "").trim().toLowerCase();
  const email = normalizeEmail(body.email);
  const clientIp = extractClientIp(request);
  if (action === "request") {
    const throttle = enforceIpThrottle(
      `password-reset:request:${clientIp}`,
      RESET_REQUEST_IP_LIMIT,
      RESET_REQUEST_IP_WINDOW_MS,
    );
    if (!throttle.allowed) {
      return NextResponse.json(
        { ok: false, error: "Please wait before requesting another reset code." },
        { status: 429 },
      );
    }
    return requestReset(email);
  }

  if (action === "reset") {
    const throttle = enforceIpThrottle(
      `password-reset:apply:${clientIp}`,
      RESET_APPLY_IP_LIMIT,
      RESET_APPLY_IP_WINDOW_MS,
    );
    if (!throttle.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many reset attempts. Try again later." },
        { status: 429 },
      );
    }
    return applyReset(
      email,
      normalizeCode(body.code),
      String(body.password || ""),
    );
  }

  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
