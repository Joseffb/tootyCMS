import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPendingDatabaseMigrations, getDatabaseHealthReport } from "../../lib/db-health";
import {
  createSiteMenu,
  createSiteMenuItem,
  getSiteMenuDefinitionByKey,
  updateSiteMenu,
  updateSiteMenuItem,
} from "../../lib/menu-system";
import { ensureSiteTaxonomyTables } from "../../lib/site-taxonomy-tables";
import { getSettingByKey, setSettingByKey } from "../../lib/settings-store";
import { addSessionTokenCookie } from "./helpers/auth";
import { getAppHostname, getAppOrigin } from "./helpers/env";
import {
  ensureCoreSiteDomain,
  ensureCustomSiteDomain,
  ensureNetworkSite,
  ensureNetworkUser,
  ensureSitePost,
  quotedIdentifier,
  siteDomainMetaTable,
  upsertSiteMeta,
} from "./helpers/storage";
import { tiptapParagraph } from "./helpers/tiptap";

const runId = "e2e-site-lifecycle";
const appOrigin = getAppOrigin();
const appHostname = getAppHostname();
const secret = String(process.env.NEXTAUTH_SECRET || "").trim();

const adminUserId = `${runId}-network-admin`;
const primarySiteId = `${runId}-primary-site`;
const secondarySiteId = `${runId}-secondary-site`;
const articleId = `${runId}-article`;
const pageId = `${runId}-page`;
const secondaryArticleId = `${runId}-secondary-article`;
const articleSlug = `${runId}-welcome`;
const pageSlug = `${runId}-about`;
const secondaryArticleSlug = `${runId}-secondary`;
const primarySubdomain = `${runId}-primary`;
const menuKey = "main-nav";
const menuItemHref = `/post/${articleSlug}`;
const setupReadyKey = `${runId}_ready`;
const setupFailedKey = `${runId}_failed`;
const setupPhaseKey = `${runId}_phase`;
const setupLockDir = path.join(process.cwd(), ".tmp-e2e-locks", runId);
const setupHeartbeatFile = path.join(setupLockDir, "heartbeat");

const carouselSetId = `${runId}-carousel-set`;
const carouselSlideId = `${runId}-carousel-slide`;
const carouselSlideTwoId = `${runId}-carousel-slide-two`;

const carouselPluginId = "tooty-carousels";
const commentsPluginId = "tooty-comments";
const devToolsPluginId = "dev-tools";
const helloTeetyPluginId = "hello-teety";
const tinybirdPluginId = "analytics-tinybird";
const gdprConsentPluginId = "gdpr-consent";
let menuId = "";
let menuItemId = "";

async function upsertSetting(key: string, value: string) {
  await setSettingByKey(key, value);
}

async function markSetupPhase(phase: string) {
  await upsertSetting(setupPhaseKey, String(phase || "").trim());
}

async function waitForLifecycleSetupReadyOrAcquireLock(timeoutMs = 480_000) {
  const deadline = Date.now() + timeoutMs;
  await mkdir(path.dirname(setupLockDir), { recursive: true });
  while (Date.now() < deadline) {
    const ready = await getSettingByKey(setupReadyKey);
    if (ready === "true") return "ready" as const;
    const failed = String((await getSettingByKey(setupFailedKey)) || "").trim();
    const phase = String((await getSettingByKey(setupPhaseKey)) || "").trim();
    try {
      await mkdir(setupLockDir);
      if (failed) {
        await upsertSetting(setupFailedKey, "");
      }
      await writeFile(setupHeartbeatFile, String(Date.now()));
      return "locked" as const;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      let details: Awaited<ReturnType<typeof stat>>;
      try {
        details = await stat(setupHeartbeatFile).catch(() => stat(setupLockDir));
      } catch {
        if (failed) {
          await upsertSetting(setupFailedKey, "");
        }
        continue;
      }
      const isStale = Date.now() - details.mtimeMs > 45_000;
      if (isStale) {
        await rm(setupLockDir, { recursive: true, force: true });
        if (failed) {
          await upsertSetting(setupFailedKey, "");
        }
        continue;
      }
      if (failed) {
        throw new Error(
          `Lifecycle setup failed${phase ? ` during phase ${phase}` : ""}: ${failed}`,
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for lifecycle setup marker: ${setupReadyKey}`);
}

async function waitForHealthyDatabase(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const report = await getDatabaseHealthReport();
    if (report.ok && !report.migrationRequired) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for database health to settle.");
}

async function ensureLifecycleDatabaseReady() {
  const report = await getDatabaseHealthReport();
  if (report.ok && !report.migrationRequired) return;
  await markSetupPhase("db-migrate");
  await applyPendingDatabaseMigrations();
  await markSetupPhase("db-health");
  await waitForHealthyDatabase();
}

function startSetupLockHeartbeat() {
  const timer = setInterval(() => {
    void writeFile(setupHeartbeatFile, String(Date.now()));
  }, 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function authenticateAsAdmin(page: Page) {
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for site lifecycle e2e.");
  const token = await encode({
    secret,
    token: {
      sub: adminUserId,
      email: `${runId}@example.com`,
      name: "Lifecycle Network Admin",
      role: "network admin",
      user: {
        id: adminUserId,
        email: `${runId}@example.com`,
        name: "Lifecycle Network Admin",
        role: "network admin",
      },
    },
    maxAge: 60 * 60 * 24,
  });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    domain: appHostname,
    expires,
  });
}

async function gotoAdminPage(page: Page, url: string, timeoutMs = 20_000) {
  await page.goto(url);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bannerVisible = await page.getByText("A schema update for for this CMS is required.").isVisible().catch(() => false);
    if (!bannerVisible) return;
    await page.waitForTimeout(500);
    await page.reload();
  }
  throw new Error(`Admin schema banner did not clear for ${url}`);
}

async function expectPageStable(page: Page) {
  await expect(page.locator("body")).not.toContainText(/Application error|Maximum call stack size exceeded|Unhandled Runtime Error/i);
}

async function seedCarouselData() {
  await ensureCustomSiteDomain(primarySiteId, {
    key: "carousel",
    label: "Carousel",
    description: "Carousel entries used by themes.",
    settings: { pluginOwner: "tooty-carousels", pluginManaged: true, showInMenu: false },
  });
  await ensureCustomSiteDomain(primarySiteId, {
    key: "carousel-slide",
    label: "Carousel Slide",
    description: "Slides attached to a carousel.",
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

  await ensureSitePost({
    id: carouselSetId,
    siteId: primarySiteId,
    domainKey: "carousel",
    userId: adminUserId,
    slug: "homepage",
    title: "Homepage Carousel",
    description: "Primary lifecycle carousel",
    content: "",
    published: true,
  });
  await sql.query(
    `INSERT INTO ${quotedIdentifier(siteDomainMetaTable(primarySiteId, "carousel"))}
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
    id: carouselSlideId,
    siteId: primarySiteId,
    domainKey: "carousel-slide",
    userId: adminUserId,
    slug: `${runId}-slide-one`,
    title: "Lifecycle Slide One",
    description: "First lifecycle slide",
    content: "",
    published: true,
  });
  await ensureSitePost({
    id: carouselSlideTwoId,
    siteId: primarySiteId,
    domainKey: "carousel-slide",
    userId: adminUserId,
    slug: `${runId}-slide-two`,
    title: "Lifecycle Slide Two",
    description: "Second lifecycle slide",
    content: "",
    published: true,
  });
  await sql.query(
    `INSERT INTO ${quotedIdentifier(siteDomainMetaTable(primarySiteId, "carousel-slide"))}
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
    [carouselSlideId, carouselSetId, carouselSlideTwoId],
  );
}

async function ensureLifecycleMenu() {
  const existingMenu = await getSiteMenuDefinitionByKey(primarySiteId, menuKey);
  const menu = existingMenu
    ? await updateSiteMenu(primarySiteId, existingMenu.id, {
        key: menuKey,
        title: "Main Navigation",
        location: "header",
        description: "Lifecycle seeded menu",
        sortOrder: 10,
      })
    : await createSiteMenu(primarySiteId, {
        key: menuKey,
        title: "Main Navigation",
        location: "header",
        description: "Lifecycle seeded menu",
        sortOrder: 10,
      });
  menuId = menu.id;

  const hydratedMenu = await getSiteMenuDefinitionByKey(primarySiteId, menuKey);
  const existingItem = hydratedMenu?.items.find((item) => item.href === menuItemHref) || null;
  const menuItemInput = {
    title: "Welcome",
    href: menuItemHref,
    description: "Seeded lifecycle menu item",
    sortOrder: 10,
  };
  const menuItem = existingItem
    ? await updateSiteMenuItem(primarySiteId, menu.id, existingItem.id, menuItemInput)
    : await createSiteMenuItem(primarySiteId, menu.id, menuItemInput);
  menuItemId = menuItem.id;
}

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  const waitResult = await waitForLifecycleSetupReadyOrAcquireLock();
  if (waitResult === "ready") return;
  const stopHeartbeat = startSetupLockHeartbeat();
  try {
    if ((await getSettingByKey(setupReadyKey)) === "true") return;
    await upsertSetting(setupFailedKey, "");
    await markSetupPhase("start");

    await markSetupPhase("setup-completed");
    await upsertSetting("setup_completed", "true");

    await markSetupPhase("network-user");
    await ensureNetworkUser({
      id: adminUserId,
      email: `${runId}@example.com`,
      name: "Lifecycle Network Admin",
      role: "network admin",
      authProvider: "native",
    });

    await markSetupPhase("network-sites");
    await ensureNetworkSite({
      id: primarySiteId,
      userId: adminUserId,
      name: "Lifecycle Primary Site",
      subdomain: primarySubdomain,
      isPrimary: false,
    });
    await ensureNetworkSite({
      id: secondarySiteId,
      userId: adminUserId,
      name: "Lifecycle Secondary Site",
      subdomain: `${runId}-secondary`,
      isPrimary: false,
    });

    await markSetupPhase("plugin-settings");
    await upsertSetting(`plugin_${carouselPluginId}_enabled`, "true");
    await upsertSetting(`site_${primarySiteId}_plugin_${carouselPluginId}_enabled`, "true");
    await upsertSetting(`plugin_${commentsPluginId}_enabled`, "true");
    await upsertSetting(`site_${primarySiteId}_plugin_${commentsPluginId}_enabled`, "true");
    await upsertSetting(`plugin_${devToolsPluginId}_enabled`, "true");
    await upsertSetting(`site_${primarySiteId}_plugin_${devToolsPluginId}_enabled`, "true");
    await upsertSetting(`plugin_${helloTeetyPluginId}_enabled`, "true");
    await upsertSetting(`site_${primarySiteId}_plugin_${helloTeetyPluginId}_enabled`, "true");
    await upsertSetting(`plugin_${tinybirdPluginId}_enabled`, "true");
    await upsertSetting(`site_${primarySiteId}_plugin_${tinybirdPluginId}_enabled`, "true");
    await upsertSetting(`plugin_${gdprConsentPluginId}_enabled`, "true");
    await upsertSetting(`site_${primarySiteId}_plugin_${gdprConsentPluginId}_enabled`, "true");

    await ensureLifecycleDatabaseReady();

    await markSetupPhase("core-domains");
    await ensureCoreSiteDomain(primarySiteId, "post");
    await ensureCoreSiteDomain(primarySiteId, "page");
    await ensureCoreSiteDomain(secondarySiteId, "post");
    await ensureSiteTaxonomyTables(primarySiteId);
    await ensureSiteTaxonomyTables(secondarySiteId);

    await markSetupPhase("primary-article");
    await ensureSitePost({
      id: articleId,
      siteId: primarySiteId,
      domainKey: "post",
      userId: adminUserId,
      slug: articleSlug,
      title: "Lifecycle Welcome Article",
      description: "Primary seeded article for the lifecycle dashboard flow.",
      content: tiptapParagraph("Lifecycle article body."),
      published: true,
    });
    await upsertSiteMeta({
      siteId: primarySiteId,
      domainKey: "post",
      postId: articleId,
      key: "view_count",
      value: "9",
    });

    await markSetupPhase("primary-page");
    await ensureSitePost({
      id: pageId,
      siteId: primarySiteId,
      domainKey: "page",
      userId: adminUserId,
      slug: pageSlug,
      title: "Lifecycle About Page",
      description: "Primary seeded page for the lifecycle dashboard flow.",
      content: tiptapParagraph("Lifecycle page body."),
      published: true,
    });

    await markSetupPhase("secondary-article");
    await ensureSitePost({
      id: secondaryArticleId,
      siteId: secondarySiteId,
      domainKey: "post",
      userId: adminUserId,
      slug: secondaryArticleSlug,
      title: "Lifecycle Secondary Article",
      description: "Secondary site content for network dashboard coverage.",
      content: tiptapParagraph("Secondary article body."),
      published: true,
    });

    await markSetupPhase("carousel-seed");
    await seedCarouselData();

    await markSetupPhase("menu-seed");
    await ensureLifecycleMenu();
    await markSetupPhase("ready");
    await upsertSetting(setupReadyKey, "true");
    await upsertSetting(setupFailedKey, "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertSetting(setupFailedKey, message);
    throw error;
  } finally {
    if ((await getSettingByKey(setupReadyKey)) !== "true" && !(await getSettingByKey(setupFailedKey))) {
      const phase = String((await getSettingByKey(setupPhaseKey)) || "unknown").trim() || "unknown";
      await upsertSetting(setupFailedKey, `owner exited before ready marker at phase ${phase}`);
    }
    stopHeartbeat();
    await rm(setupLockDir, { recursive: true, force: true });
  }
});

test("site lifecycle: network dashboard reflects seeded content", async ({ page }) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/cp`);

  await expect(page.getByRole("heading", { name: "Network Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Newest Articles (Network)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most Popular Articles (Network)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.locator(`a[href="/app/site/${primarySiteId}/domain/post/post/${articleId}"]`).first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText("Lifecycle Primary Site").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(`a[href="/app/site/${primarySiteId}"]`).first()).toBeVisible({ timeout: 45_000 });
  await expectPageStable(page);
});

test("site lifecycle: site dashboard renders seeded content links", async ({ page }) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}`);

  await expect(page.getByRole("heading", { name: "Lifecycle Primary Site Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Newest Articles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most Popular Articles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All Articles" })).toBeVisible();
  const articleEditorLink = page.locator(`a[href="/app/site/${primarySiteId}/domain/post/post/${articleId}"]`).first();
  await expect(articleEditorLink).toBeVisible();
  await expect(page.locator(`a[href="/app/site/${primarySiteId}/domain/page/post/${pageId}"]`).first()).toBeVisible();
  await expectPageStable(page);

  const articleEditorHref = await articleEditorLink.getAttribute("href");
  if (!articleEditorHref) {
    throw new Error("Lifecycle article editor link did not expose an href.");
  }
  expect(articleEditorHref).toContain(`/app/site/${primarySiteId}/domain/post/post/${articleId}`);
});

test("site lifecycle: network settings surfaces render", async ({ page }) => {
  await authenticateAsAdmin(page);

  await gotoAdminPage(page, `${appOrigin}/app/settings`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Themes", level: 2 })).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/settings/plugins?tab=installed&view=all`);
  await expect(page.getByText("Plugins are discovered from configured paths")).toBeVisible();
  await expect(page.locator("tr", { hasText: carouselPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: commentsPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: devToolsPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: helloTeetyPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: tinybirdPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: gdprConsentPluginId }).first()).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/settings/themes?tab=installed&view=all`);
  await expect(page.getByText("Themes are discovered from configured paths")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/settings/users`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Users (Admin)")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/profile`);
  await expect(page.getByText("Global user identity. This applies across all sites.")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/settings/database`);
  await expect(page.getByRole("heading", { name: "Database Updates", level: 2 })).toBeVisible();
  await expectPageStable(page);
});

test("site lifecycle: site settings index and detail pages render", async ({ page }) => {
  await authenticateAsAdmin(page);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings`);
  await expect(page.getByText("Settings for Lifecycle Primary Site")).toBeVisible();
  await expect(page.getByText("The name of your site.")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings/plugins?tab=installed&view=all`);
  await expect(page.getByText("Site Plugins")).toBeVisible();
  await expect(page.locator("tr", { hasText: carouselPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: commentsPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: devToolsPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: helloTeetyPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: tinybirdPluginId }).first()).toBeVisible();
  await expect(page.locator("tr", { hasText: gdprConsentPluginId }).first()).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings/themes?tab=installed&view=all`);
  await expect(page.getByText("Site Theme")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings/comments`);
  await expect(page.getByText("Site-level comment moderation and review.")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings/users`);
  await expect(page.getByText("Site Users")).toBeVisible();
  await expectPageStable(page);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings/menus`);
  await expect(page.getByText("Site Menus")).toBeVisible();
  await expect(page.getByText("Main Navigation")).toBeVisible();
  await expectPageStable(page);

  await Promise.all([
    page.waitForURL(new RegExp(`/app/(?:cp/)?site/${primarySiteId}/settings/menus\\?menu=`), { timeout: 20_000 }),
    page.getByRole("link", { name: "Main Navigation", exact: true }).first().click(),
  ]);
  await expect(page.getByRole("heading", { name: "Main Navigation", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Menu Items" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Welcome Seeded lifecycle menu item/i })).toBeVisible();
  await expectPageStable(page);

  await Promise.all([
    page.waitForURL(
      new RegExp(`/app/(?:cp/)?site/${primarySiteId}/settings/menus\\?menu=.*&item=.*&editItem=`),
      { timeout: 20_000 },
    ),
    page.getByRole("link", { name: "Edit menu item Welcome" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Main Navigation", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Edit Menu Item" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Save Menu Item" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Delete Menu Item")).toBeVisible({ timeout: 20_000 });
  await expectPageStable(page);
});

test("site lifecycle: carousel workspace renders seeded set", async ({ page }) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/plugins/tooty-carousels?tab=carousels&siteId=${primarySiteId}&set=${carouselSetId}`);

  await expect(page.getByRole("heading", { name: "Slide Order" })).toBeVisible();
  await expect(page.getByText("Lifecycle Slide One")).toBeVisible();
  await expectPageStable(page);
});
