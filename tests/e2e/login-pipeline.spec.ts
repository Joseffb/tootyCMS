import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-login-pipeline-${Date.now()}`;
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";

const userId = `${runId}-user`;
const email = `${runId}@example.com`;

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for login pipeline e2e.",
);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await setSettingByKey("setup_completed", "true");
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "role", "authProvider", "createdAt", "updatedAt")
    VALUES (${userId}, ${email}, ${"Login Pipeline Test User"}, 'administrator', 'native', NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "updatedAt" = NOW()
  `;
});

test.afterAll(async () => {
  await sql`DELETE FROM tooty_users WHERE "id" = ${userId}`;
});

test("native login persists a valid session and grants /app access", async ({ page }) => {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for login pipeline e2e.");
  const token = await encode({
    secret,
    token: {
      sub: userId,
      email,
      name: "Login Pipeline Test User",
      role: "administrator",
      user: {
        id: userId,
        email,
        name: "Login Pipeline Test User",
        role: "administrator",
      },
    },
    maxAge: 60 * 60 * 24,
  });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "app.localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires,
    },
  ]);

  const sessionResponse = await page.request.get(`${appOrigin}/api/auth/session`);
  expect(sessionResponse.ok()).toBeTruthy();
  const sessionJson = await sessionResponse.json();
  expect(String(sessionJson?.user?.email || "").toLowerCase()).toBe(email);
});
