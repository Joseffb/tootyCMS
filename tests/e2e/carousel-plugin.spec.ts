import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-carousel-${Date.now()}`;
const password = "password123";
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";
const runPluginPermsE2E = process.env.RUN_PLUGIN_PERMS_E2E === "1";

const adminEmail = `${runId}-admin@example.com`;
const adminUserId = `${runId}-admin-user`;
const siteId = `${runId}-site`;
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
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "role", "authProvider", "passwordHash", "createdAt", "updatedAt")
    VALUES (${params.id}, ${params.email}, ${params.name}, ${params.role}, 'native', ${params.passwordHash}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "passwordHash" = EXCLUDED."passwordHash",
        "updatedAt" = NOW()
  `;
}

async function ensureSite(params: {
  id: string;
  userId: string;
  name: string;
  subdomain: string;
  isPrimary: boolean;
}) {
  await sql`
    INSERT INTO tooty_sites ("id", "userId", "name", "subdomain", "isPrimary", "createdAt", "updatedAt")
    VALUES (${params.id}, ${params.userId}, ${params.name}, ${params.subdomain}, ${params.isPrimary}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "userId" = EXCLUDED."userId",
        "name" = EXCLUDED."name",
        "subdomain" = EXCLUDED."subdomain",
        "isPrimary" = EXCLUDED."isPrimary",
        "updatedAt" = NOW()
  `;
}

async function authenticateAs(page: Page, userId: string) {
  const sessionToken = `e2e-${randomUUID()}`;
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await sql`
    INSERT INTO tooty_sessions ("sessionToken", "userId", "expires")
    VALUES (${sessionToken}, ${userId}, ${expires.toISOString()})
    ON CONFLICT ("sessionToken") DO UPDATE
    SET "userId" = EXCLUDED."userId", "expires" = EXCLUDED."expires"
  `;
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "app.localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(expires.getTime() / 1000),
    },
  ]);
}

async function ensureCarouselDomain() {
  await sql`
    INSERT INTO tooty_data_domains ("key", "label", "contentTable", "metaTable", "description", "settings", "createdAt", "updatedAt")
    VALUES (
      'carousel',
      'Carousel',
      'tooty_domain_carousel',
      'tooty_domain_carousel_meta',
      'Carousel entries used by themes to render panel-based sliders.',
      '{"pluginOwner":"tooty-carousels","pluginManaged":true,"showInMenu":false}'::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT ("key") DO UPDATE
    SET "label" = EXCLUDED."label",
        "description" = EXCLUDED."description",
        "settings" = EXCLUDED."settings",
        "updatedAt" = NOW()
  `;

  const domainRows = await sql<{ id: number }>`SELECT "id" FROM tooty_data_domains WHERE "key" = 'carousel' LIMIT 1`;
  const carouselDomainId = domainRows.rows[0]?.id;
  if (!carouselDomainId) throw new Error("Failed to resolve carousel data domain.");

  await sql`
    INSERT INTO tooty_site_data_domains ("siteId", "dataDomainId", "isActive", "createdAt", "updatedAt")
    VALUES (${siteId}, ${carouselDomainId}, true, NOW(), NOW())
    ON CONFLICT ("siteId", "dataDomainId") DO UPDATE
    SET "isActive" = true,
        "updatedAt" = NOW()
  `;

  await sql`
    INSERT INTO tooty_domain_posts ("id", "dataDomainId", "title", "description", "content", "slug", "image", "published", "siteId", "userId", "createdAt", "updatedAt")
    VALUES
      (${slideOneId}, ${carouselDomainId}, 'Slide One', 'First slide', '', ${`${runId}-slide-one`}, '', true, ${siteId}, ${adminUserId}, NOW(), NOW()),
      (${slideTwoId}, ${carouselDomainId}, 'Slide Two', 'Second slide', '', ${`${runId}-slide-two`}, '', true, ${siteId}, ${adminUserId}, NOW() + INTERVAL '1 minute', NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "published" = EXCLUDED."published",
        "updatedAt" = NOW()
  `;

  await sql`
    INSERT INTO tooty_domain_post_meta ("domainPostId", "key", "value", "createdAt", "updatedAt")
    VALUES
      (${slideOneId}, 'sort_order', '0', NOW(), NOW()),
      (${slideTwoId}, 'sort_order', '1', NOW(), NOW())
    ON CONFLICT ("domainPostId", "key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = NOW()
  `;
}

async function readSortOrder(domainPostId: string) {
  const result = await sql<{ value: string }>`
    SELECT "value"
    FROM tooty_domain_post_meta
    WHERE "domainPostId" = ${domainPostId} AND "key" = 'sort_order'
    LIMIT 1
  `;
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
    isPrimary: true,
  });

  await ensureCarouselDomain();
});

test("carousel plugin drag-and-drop reorders slides and persists sort_order", async ({ page }) => {
  await authenticateAs(page, adminUserId);
  await page.goto(`${appOrigin}/app/plugins/tooty-carousels?tab=slides&siteId=${siteId}`);

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
