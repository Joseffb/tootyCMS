import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../../lib/password";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";
import { getAppOrigin } from "./helpers/env";
import { addSessionTokenCookie } from "./helpers/auth";
import { sqlClient } from "./helpers/vercel-sql";
import { ensureNetworkSite, ensureNetworkUser, networkTableName, quotedIdentifier, siteFeatureTableName } from "./helpers/storage";

const runId = `e2e-comm-${randomUUID()}`;
const runCommunicationE2E = process.env.RUN_COMMUNICATION_E2E === "1";
const appOrigin = getAppOrigin();
const userId = `${runId}-admin`;
const siteId = `${runId}-site`;
const email = `${runId}@example.com`;
const siteQueueTable = quotedIdentifier(siteFeatureTableName(siteId, "domain_events_queue"));

async function upsertSetting(key: string, value: string) {
  await setSettingByKey(key, value);
}

async function upsertSiteSetting(siteId: string, key: string, value: string) {
  await upsertSetting(`site_${siteId}_${key}`, value);
}

async function ensureSchema() {
  await sqlClient.query(`
    CREATE TABLE IF NOT EXISTS ${quotedIdentifier(networkTableName("communication_messages"))} (
      "id" text PRIMARY KEY,
      "siteId" text NULL,
      "channel" text NOT NULL,
      "to" text NOT NULL,
      "subject" text NULL,
      "body" text NOT NULL,
      "category" text NOT NULL DEFAULT 'transactional',
      "status" text NOT NULL DEFAULT 'queued',
      "providerId" text NULL,
      "externalId" text NULL,
      "attemptCount" integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 3,
      "nextAttemptAt" timestamp NULL,
      "lastError" text NULL,
      "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdByUserId" text NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `);
  await sqlClient.query(`
    CREATE TABLE IF NOT EXISTS ${quotedIdentifier(networkTableName("communication_attempts"))} (
      "id" serial PRIMARY KEY,
      "messageId" text NOT NULL,
      "providerId" text NOT NULL,
      "eventId" text NULL,
      "status" text NOT NULL,
      "error" text NULL,
      "response" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `);
  await sqlClient.query(`
    CREATE TABLE IF NOT EXISTS ${quotedIdentifier(networkTableName("webcallback_events"))} (
      "id" serial PRIMARY KEY,
      "siteId" text NULL,
      "handlerId" text NOT NULL,
      "pluginId" text NULL,
      "status" text NOT NULL DEFAULT 'received',
      "requestBody" text NOT NULL DEFAULT '',
      "requestHeaders" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "requestQuery" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "response" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "error" text NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `);
  await sqlClient.query(`ALTER TABLE ${quotedIdentifier(networkTableName("communication_attempts"))} ADD COLUMN IF NOT EXISTS "eventId" text NULL`);
  await sqlClient.query(`ALTER TABLE ${quotedIdentifier(networkTableName("webcallback_events"))} ADD COLUMN IF NOT EXISTS "siteId" text NULL`);
  await sqlClient.query(`
    CREATE TABLE IF NOT EXISTS ${quotedIdentifier(networkTableName("webhook_subscriptions"))} (
      "id" serial PRIMARY KEY,
      "siteId" text NULL,
      "eventName" text NOT NULL,
      "endpointUrl" text NOT NULL,
      "secret" text NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "maxRetries" integer NOT NULL DEFAULT 4,
      "backoffBaseSeconds" integer NOT NULL DEFAULT 30,
      "headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `);
  await sqlClient.query(`
    CREATE TABLE IF NOT EXISTS ${quotedIdentifier(networkTableName("webhook_deliveries"))} (
      "id" text PRIMARY KEY,
      "subscriptionId" integer NOT NULL,
      "siteId" text NULL,
      "eventId" text NOT NULL,
      "eventName" text NOT NULL,
      "endpointUrl" text NOT NULL,
      "status" text NOT NULL DEFAULT 'queued',
      "attemptCount" integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 4,
      "nextAttemptAt" timestamp NULL,
      "lastError" text NULL,
      "requestBody" text NOT NULL DEFAULT '',
      "requestHeaders" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "responseStatus" integer NULL,
      "responseBody" text NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `);
  await sqlClient.query(`
    DROP TABLE IF EXISTS ${siteQueueTable}
  `);
  await sqlClient.query(`
    CREATE TABLE IF NOT EXISTS ${siteQueueTable} (
      "id" text PRIMARY KEY,
      "event" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "status" text NOT NULL DEFAULT 'queued',
      "attempts" integer NOT NULL DEFAULT 0,
      "available_at" timestamptz NOT NULL DEFAULT now(),
      "last_error" text NULL,
      "processed_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function ensureUserAndSite() {
  const passwordHash = await hashPassword("password123");
  await ensureNetworkUser({
    id: userId,
    email,
    name: "Comm Admin",
    role: "administrator",
    authProvider: "native",
    passwordHash,
  });
  await ensureNetworkSite({
    id: siteId,
    userId,
    name: "Comms Site",
    subdomain: `${runId}-site`,
    isPrimary: true,
  });
}

async function authenticateAs(page: Page, authUserId: string) {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for communication e2e auth.");

  const token = await encode({
    secret,
    token: {
      sub: authUserId,
      email,
      name: "Comm Admin",
      role: "administrator",
    },
    maxAge: 60 * 60 * 24,
  });

  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  });
}

test.describe.configure({ mode: "serial" });
test.skip(!runCommunicationE2E, "Set RUN_COMMUNICATION_E2E=1 to run communication callback e2e.");
test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for communication e2e.",
);

test.beforeAll(async () => {
  await ensureSchema();
  await upsertSetting("setup_completed", "true");
  await upsertSetting("communication_enabled", "true");
  await upsertSetting("communication_rate_limit_max", "60");
  await upsertSetting("communication_rate_limit_window_seconds", "60");
  await ensureUserAndSite();
  await upsertSiteSetting(siteId, "communication_enabled", "true");
  await upsertSiteSetting(siteId, "communication_rate_limit_max", "60");
  await upsertSiteSetting(siteId, "communication_rate_limit_window_seconds", "60");
});

test("communication send + callback + generic webcallback flow", async ({ page }) => {
  await authenticateAs(page, userId);

  const sendRes = await page.request.post(`${appOrigin}/api/communications/send`, {
    data: {
      siteId,
      channel: "email",
      to: "customer@example.com",
      subject: "Hello",
      body: "Test communication body",
      category: "transactional",
      maxAttempts: 2,
    },
  });
  if (sendRes.status() !== 202) {
    const bodyText = await sendRes.text();
    throw new Error(`Expected 202 from send route, got ${sendRes.status()} body=${bodyText}`);
  }
  const sendJson = await sendRes.json();
  expect(sendJson.messageId).toBeTruthy();

  const row = await sqlClient.query(
    `SELECT "status", "providerId" FROM ${quotedIdentifier(networkTableName("communication_messages"))} WHERE "id" = $1 LIMIT 1`,
    [sendJson.messageId],
  );
  expect(row.rows[0]?.status).toBe("logged");
  expect(row.rows[0]?.providerId).toBe("native:null-provider");

  const queuedEventCount =
    await sqlClient.query(`SELECT COUNT(*)::int AS count FROM ${siteQueueTable} WHERE ("event"->>'name') = 'communication.queued' AND ("event"->'payload'->>'messageId') = $1`, [sendJson.messageId]);
  expect(Number(queuedEventCount.rows[0]?.count || 0)).toBe(1);

  const sentEventAfterInitialSend =
    await sqlClient.query(`SELECT COUNT(*)::int AS count FROM ${siteQueueTable} WHERE ("event"->>'name') = 'communication.sent' AND ("event"->'payload'->>'messageId') = $1`, [sendJson.messageId]);
  expect(Number(sentEventAfterInitialSend.rows[0]?.count || 0)).toBe(1);

  const callbackRes = await page.request.post(`${appOrigin}/api/communications/callback/native-null`, {
    data: {
      messageId: sendJson.messageId,
      status: "sent",
      eventType: "delivery.confirmed",
      metadata: { provider: "native-null" },
    },
  });
  expect(callbackRes.status()).toBe(202);

  const updated = await sqlClient.query(
    `SELECT "status" FROM ${quotedIdentifier(networkTableName("communication_messages"))} WHERE "id" = $1 LIMIT 1`,
    [sendJson.messageId],
  );
  expect(updated.rows[0]?.status).toBe("sent");

  const sentEventAfterCallback =
    await sqlClient.query(`SELECT COUNT(*)::int AS count FROM ${siteQueueTable} WHERE ("event"->>'name') = 'communication.sent' AND ("event"->'payload'->>'messageId') = $1`, [sendJson.messageId]);
  expect(Number(sentEventAfterCallback.rows[0]?.count || 0)).toBe(2);

  const duplicateCallbackRes = await page.request.post(`${appOrigin}/api/communications/callback/native-null`, {
    data: {
      messageId: sendJson.messageId,
      status: "sent",
      eventType: "delivery.confirmed.repeat",
    },
  });
  expect(duplicateCallbackRes.status()).toBe(202);

  const sentEventAfterDuplicateCallback =
    await sqlClient.query(`SELECT COUNT(*)::int AS count FROM ${siteQueueTable} WHERE ("event"->>'name') = 'communication.sent' AND ("event"->'payload'->>'messageId') = $1`, [sendJson.messageId]);
  expect(Number(sentEventAfterDuplicateCallback.rows[0]?.count || 0)).toBe(2);

  const genericCallbackRes = await page.request.post(`${appOrigin}/api/webcallbacks/no-handler`, {
    data: { ping: true },
  });
  expect(genericCallbackRes.status()).toBe(404);

  const event = await sqlClient.query(
    `SELECT "status" FROM ${quotedIdentifier(networkTableName("webcallback_events"))} WHERE "handlerId" = 'no-handler' ORDER BY "id" DESC LIMIT 1`,
  );
  expect(event.rows[0]?.status).toBe("ignored");
});

test("communication governance toggle and per-site rate limiting are enforced", async ({ page }) => {
  await authenticateAs(page, userId);

  await upsertSiteSetting(siteId, "communication_enabled", "false");
  const disabledRes = await page.request.post(`${appOrigin}/api/communications/send`, {
    data: {
      siteId,
      channel: "email",
      to: "blocked@example.com",
      body: "Should be blocked",
    },
  });
  expect(disabledRes.status()).toBe(403);
  const disabledJson = await disabledRes.json();
  expect(disabledJson.code).toBe("disabled");

  await upsertSiteSetting(siteId, "communication_enabled", "true");
  await sqlClient.query(
    `DELETE FROM ${quotedIdentifier(networkTableName("communication_messages"))} WHERE "siteId" = $1`,
    [siteId],
  );
  await upsertSiteSetting(siteId, "communication_rate_limit_max", "1");
  await upsertSiteSetting(siteId, "communication_rate_limit_window_seconds", "3600");

  const first = await page.request.post(`${appOrigin}/api/communications/send`, {
    data: {
      siteId,
      channel: "email",
      to: "first@example.com",
      body: "Allowed first message",
    },
  });
  expect(first.status()).toBe(202);

  const second = await page.request.post(`${appOrigin}/api/communications/send`, {
    data: {
      siteId,
      channel: "email",
      to: "second@example.com",
      body: "Should be rate limited",
    },
  });
  expect(second.status()).toBe(429);
  const secondJson = await second.json();
  expect(secondJson.code).toBe("rate_limited");

  await upsertSiteSetting(siteId, "communication_rate_limit_max", "60");
  await upsertSiteSetting(siteId, "communication_rate_limit_window_seconds", "60");
});
