import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";
import { getAppOrigin } from "./helpers/env";
import { addSessionTokenCookie } from "./helpers/auth";
import {
  ensureCustomSiteDomain,
  ensureNetworkSession,
  ensureNetworkSite,
  ensureNetworkUser,
  ensureSitePost,
  networkTableName,
  quotedIdentifier,
  siteDomainContentTable,
  siteDomainMetaTable,
} from "./helpers/storage";

const runId = `e2e-carousel-${randomUUID()}`;
const password = "password123";
const appOrigin = getAppOrigin();
const runPluginPermsE2E = process.env.RUN_PLUGIN_PERMS_E2E === "1";

const adminEmail = `${runId}-admin@example.com`;
const adminUserId = `${runId}-admin-user`;
const siteId = `${runId}-site`;
const carouselSetId = `${runId}-carousel-set`;
const slideOneId = `${runId}-slide-one`;
const slideTwoId = `${runId}-slide-two`;

async function upsertSetting(key: string, value: string) {
  await setSettingByKey(key, value);
}

async function ensureUser(params: {
  id: string;
  email: string;
  name: string;
  role: "administrator" | "editor" | "network admin";
  passwordHash: string;
}) {
  await ensureNetworkUser({
    ...params,
    authProvider: "native",
  });
}

async function ensureSite(params: {
  id: string;
  userId: string;
  name: string;
  subdomain: string;
  isPrimary: boolean;
}) {
  await ensureNetworkSite(params);
}

async function authenticateAs(page: Page, userId: string) {
  const sessionToken = `e2e-${randomUUID()}`;
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await ensureNetworkSession(sessionToken, userId, expires);
  await addSessionTokenCookie(page.context(), {
    value: sessionToken,
    origin: appOrigin,
    expires: Math.floor(expires.getTime() / 1000),
  });
}

async function ensureCarouselDomain() {
  const carouselDomain = await ensureCustomSiteDomain(siteId, {
    key: "carousel",
    label: "Carousel",
    description: "Carousel entries used by themes to render panel-based sliders.",
    settings: { pluginOwner: "tooty-carousels", pluginManaged: true, showInMenu: false },
  });
  const carouselSlideDomain = await ensureCustomSiteDomain(siteId, {
    key: "carousel-slide",
    label: "Carousel Slide",
    description: "Slides that belong to a carousel set.",
    settings: {
      pluginOwner: "tooty-carousels",
      pluginManaged: true,
      showInMenu: false,
      parentKey: "carousel",
      parentMetaKey: "carousel_id",
      embedHandleMetaKey: "carousel_key",
      workflowStates: ["draft", "published", "archived"],
      mediaFieldKeys: ["image", "media_id"],
    },
  });
  if (!carouselDomain.id || !carouselSlideDomain.id) {
    throw new Error("Failed to resolve carousel data domains.");
  }

  await ensureSitePost({
    id: carouselSetId,
    siteId,
    domainKey: "carousel",
    userId: adminUserId,
    slug: "homepage",
    title: "Homepage Carousel",
    description: "Primary hero carousel",
    content: "",
    published: true,
  });

  await sql.query(
    `INSERT INTO ${quotedIdentifier(siteDomainMetaTable(siteId, "carousel"))}
      ("domainPostId", "key", "value", "createdAt", "updatedAt")
    VALUES
      ($1, 'embed_key', 'homepage', NOW(), NOW()),
      ($1, 'workflow_state', 'published', NOW(), NOW())
    ON CONFLICT ("domainPostId", "key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = NOW()`,
    [carouselSetId],
  );

  await ensureSitePost({
    id: slideOneId,
    siteId,
    domainKey: "carousel-slide",
    userId: adminUserId,
    slug: `${runId}-slide-one`,
    title: "Slide One",
    description: "First slide",
    content: "",
    published: true,
  });
  await ensureSitePost({
    id: slideTwoId,
    siteId,
    domainKey: "carousel-slide",
    userId: adminUserId,
    slug: `${runId}-slide-two`,
    title: "Slide Two",
    description: "Second slide",
    content: "",
    published: true,
  });

  await sql.query(
    `INSERT INTO ${quotedIdentifier(siteDomainMetaTable(siteId, "carousel-slide"))}
      ("domainPostId", "key", "value", "createdAt", "updatedAt")
    VALUES
      ($1, 'carousel_id', $2, NOW(), NOW()),
      ($1, 'carousel_key', 'homepage', NOW(), NOW()),
      ($1, 'workflow_state', 'published', NOW(), NOW()),
      ($1, 'sort_order', '0', NOW(), NOW()),
      ($3, 'carousel_id', $2, NOW(), NOW()),
      ($3, 'carousel_key', 'homepage', NOW(), NOW()),
      ($3, 'workflow_state', 'published', NOW(), NOW()),
      ($3, 'sort_order', '1', NOW(), NOW())
    ON CONFLICT ("domainPostId", "key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = NOW()`,
    [slideOneId, carouselSetId, slideTwoId],
  );
}

async function readSortOrder(domainPostId: string) {
  const result = await sql.query<{ value: string }>(
    `SELECT "value"
     FROM ${quotedIdentifier(siteDomainMetaTable(siteId, "carousel-slide"))}
     WHERE "domainPostId" = $1 AND "key" = 'sort_order'
     LIMIT 1`,
    [domainPostId],
  );
  return String(result.rows[0]?.value || "");
}

test.describe.configure({ mode: "serial" });
test.skip(!runPluginPermsE2E, "Set RUN_PLUGIN_PERMS_E2E=1 to run carousel plugin e2e.");
test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for carousel plugin e2e.",
);

test.beforeAll(async () => {
  const passwordHash = await hashPassword(password);
  await upsertSetting("setup_completed", "true");
  await upsertSetting("plugin_tooty-carousels_enabled", "true");
  await upsertSetting(`site_${siteId}_plugin_tooty-carousels_enabled`, "true");

  await ensureUser({
    id: adminUserId,
    email: adminEmail,
    name: "Carousel Admin",
    role: "administrator",
    passwordHash,
  });

  await ensureSite({
    id: siteId,
    userId: adminUserId,
    name: "Carousel Site",
    subdomain: `${runId}-site`,
    isPrimary: false,
  });

  await ensureCarouselDomain();
});

test("carousel plugin drag-and-drop reorders slides and persists sort_order", async ({ page }) => {
  await authenticateAs(page, adminUserId);
  await page.goto(`${appOrigin}/app/plugins/tooty-carousels?tab=carousels&siteId=${siteId}&set=${carouselSetId}`);

  await expect(page.getByRole("heading", { name: "Slide Order" })).toBeVisible();

  const firstRow = page.locator('[draggable="true"]').filter({ hasText: "Slide One" }).first();
  const secondRow = page.locator('[draggable="true"]').filter({ hasText: "Slide Two" }).first();

  await expect(page.locator('[draggable="true"]').nth(0)).toContainText("Slide One");
  await firstRow.dragTo(secondRow);
  await expect(page.locator('[draggable="true"]').nth(0)).toContainText("Slide Two");

  await page.getByRole("button", { name: "Save Order" }).click();

  await expect.poll(async () => await readSortOrder(slideTwoId)).toBe("0");
  await expect.poll(async () => await readSortOrder(slideOneId)).toBe("1");

  await page.reload();
  await expect(page.locator('[draggable="true"]').nth(0)).toContainText("Slide Two");
});

test.afterAll(async () => {
  await sql.query(
    `DELETE FROM ${quotedIdentifier(siteDomainMetaTable(siteId, "carousel-slide"))}
     WHERE "domainPostId" IN ($1, $2)`,
    [slideOneId, slideTwoId],
  );
  await sql.query(
    `DELETE FROM ${quotedIdentifier(siteDomainMetaTable(siteId, "carousel"))}
     WHERE "domainPostId" = $1`,
    [carouselSetId],
  );
  await sql.query(
    `DELETE FROM ${quotedIdentifier(siteDomainContentTable(siteId, "carousel-slide"))}
     WHERE "id" IN ($1, $2)`,
    [slideOneId, slideTwoId],
  );
  await sql.query(
    `DELETE FROM ${quotedIdentifier(siteDomainContentTable(siteId, "carousel"))}
     WHERE "id" = $1`,
    [carouselSetId],
  );
  await sql.query(`DELETE FROM ${quotedIdentifier(networkTableName("sites"))} WHERE "id" = $1`, [siteId]);
  await sql.query(`DELETE FROM ${quotedIdentifier(networkTableName("users"))} WHERE "id" = $1`, [adminUserId]);
});
