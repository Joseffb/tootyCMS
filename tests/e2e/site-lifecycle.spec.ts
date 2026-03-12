import { expect, test, type Locator, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import db from "../../lib/db";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { encode } from "next-auth/jwt";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPendingDatabaseMigrations, getDatabaseHealthReport } from "../../lib/db-health";
import { getSitePublicUrl } from "../../lib/site-url";
import {
  createSiteMenu,
  createSiteMenuItem,
  getSiteMenuDefinitionByKey,
  updateSiteMenu,
  updateSiteMenuItem,
} from "../../lib/menu-system";
import { ensureSiteTaxonomyTables, getSiteTaxonomyTables } from "../../lib/site-taxonomy-tables";
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
import { getSiteDomainPostById } from "../../lib/site-domain-post-store";

const runId = "e2e-site-lifecycle";
const appOrigin = getAppOrigin();
const appHostname = getAppHostname();
const secret = String(process.env.NEXTAUTH_SECRET || "").trim();

let lifecycleScope = "shared";
let scopedRunId = `${runId}-${lifecycleScope}`;
let adminUserId = `${scopedRunId}-network-admin`;
let primarySiteId = `${scopedRunId}-primary-site`;
let secondarySiteId = `${scopedRunId}-secondary-site`;
let articleId = `${scopedRunId}-article`;
let pageId = `${scopedRunId}-page`;
let secondaryArticleId = `${scopedRunId}-secondary-article`;
let articleSlug = `${scopedRunId}-welcome`;
let pageSlug = `${scopedRunId}-about`;
let secondaryArticleSlug = `${scopedRunId}-secondary`;
let primarySubdomain = `${scopedRunId}-primary`;
let primaryPublicUrl = getSitePublicUrl({
  subdomain: primarySubdomain,
  customDomain: null,
  isPrimary: false,
}).replace(/\/$/, "");
const menuKey = "main-nav";
let menuItemHref = `/post/${articleSlug}`;
let setupReadyKey = `${scopedRunId}_ready`;
let setupFailedKey = `${scopedRunId}_failed`;
let setupPhaseKey = `${scopedRunId}_phase`;
let setupLockDir = path.join(process.cwd(), ".tmp-e2e-locks", scopedRunId);
let setupHeartbeatFile = path.join(setupLockDir, "heartbeat");

let carouselSetId = `${scopedRunId}-carousel-set`;
let carouselSlideId = `${scopedRunId}-carousel-slide`;
let carouselSlideTwoId = `${scopedRunId}-carousel-slide-two`;

const carouselPluginId = "tooty-carousels";
const commentsPluginId = "tooty-comments";
const devToolsPluginId = "dev-tools";
const helloTeetyPluginId = "hello-teety";
const tinybirdPluginId = "analytics-tinybird";
const gdprConsentPluginId = "gdpr-consent";
let menuId = "";
let menuItemId = "";

function configureLifecycleScope(scope: string) {
  lifecycleScope = String(scope || "shared").trim() || "shared";
  scopedRunId = `${runId}-${lifecycleScope}`;
  adminUserId = `${scopedRunId}-network-admin`;
  primarySiteId = `${scopedRunId}-primary-site`;
  secondarySiteId = `${scopedRunId}-secondary-site`;
  articleId = `${scopedRunId}-article`;
  pageId = `${scopedRunId}-page`;
  secondaryArticleId = `${scopedRunId}-secondary-article`;
  articleSlug = `${scopedRunId}-welcome`;
  pageSlug = `${scopedRunId}-about`;
  secondaryArticleSlug = `${scopedRunId}-secondary`;
  primarySubdomain = `${scopedRunId}-primary`;
  primaryPublicUrl = getSitePublicUrl({
    subdomain: primarySubdomain,
    customDomain: null,
    isPrimary: false,
  }).replace(/\/$/, "");
  menuItemHref = `/post/${articleSlug}`;
  setupReadyKey = `${scopedRunId}_ready`;
  setupFailedKey = `${scopedRunId}_failed`;
  setupPhaseKey = `${scopedRunId}_phase`;
  setupLockDir = path.join(process.cwd(), ".tmp-e2e-locks", scopedRunId);
  setupHeartbeatFile = path.join(setupLockDir, "heartbeat");
  carouselSetId = `${scopedRunId}-carousel-set`;
  carouselSlideId = `${scopedRunId}-carousel-slide`;
  carouselSlideTwoId = `${scopedRunId}-carousel-slide-two`;
  menuId = "";
  menuItemId = "";
}

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
      email: `${scopedRunId}@example.com`,
      name: "Lifecycle Network Admin",
      role: "network admin",
      user: {
        id: adminUserId,
        email: `${scopedRunId}@example.com`,
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

async function gotoAdminPage(page: Page, url: string, timeoutMs = 60_000) {
  const target = new URL(url);
  target.searchParams.set("__e2e_nav", String(Date.now()));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Could not connect to the server") ||
        message.includes("net::ERR_CONNECTION_REFUSED") ||
        message.includes("NS_ERROR_CONNECTION_REFUSED")
      ) {
        await page.waitForTimeout(500);
        continue;
      }
      if (message.includes("interrupted by another navigation")) {
        await page.waitForTimeout(300);
        continue;
      }
      throw error;
    }
    const bannerVisible = await page.getByText("A schema update for for this CMS is required.").isVisible().catch(() => false);
    const siteMissingVisible = await page
      .getByText("Site does not exist, or you do not have permission to view it")
      .isVisible()
      .catch(() => false);
    const notFoundVisible = await page.getByRole("heading", { name: "404" }).isVisible().catch(() => false);
    if (!bannerVisible && !siteMissingVisible && !notFoundVisible) return;
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  throw new Error(`Admin schema banner did not clear for ${url}`);
}

async function expectPageStable(page: Page) {
  await expect(page.locator("body")).not.toContainText(/Application error|Maximum call stack size exceeded|Unhandled Runtime Error/i);
}

async function expectCurrentUrlToMatch(page: Page, pattern: RegExp, timeoutMs = 30_000) {
  await expect
    .poll(
      () => page.url(),
      {
        timeout: timeoutMs,
        message: `Expected current page URL to match ${pattern}`,
      },
    )
    .toMatch(pattern);
}

async function waitForEditorSaved(page: Page) {
  await expect
    .poll(
      async () => {
        const visibleSavingButtons = await page
          .getByRole("button", { name: /^Saving/ })
          .evaluateAll((elements) =>
            elements.filter((element) => {
              const node = element as HTMLElement;
              const style = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0
              );
            }).length,
          )
          .catch(() => 0);
        if (visibleSavingButtons > 0) return "saving";
        const unsavedVisible = await page.getByText("Unsaved").first().isVisible().catch(() => false);
        if (unsavedVisible) return "unsaved";
        const savedVisible = await page.getByText("Saved").first().isVisible().catch(() => false);
        if (savedVisible) return "saved";
        const saveButton = page.getByRole("button", { name: /^Save Changes$/ }).first();
        const saveVisible = await saveButton.isVisible().catch(() => false);
        const saveEnabled = saveVisible ? await saveButton.isEnabled().catch(() => false) : false;
        return saveVisible && saveEnabled ? "idle" : "pending";
      },
      {
        timeout: 90_000,
        message: "Expected editor save state to settle",
      },
    )
    .toMatch(/saved|idle/);
}

async function waitForEditorSavedWithReload(page: Page, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await waitForEditorSaved(page);
      return;
    } catch (error) {
      lastError = error;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await waitForEditorSurface(page, 60_000, { requireEditable: true }).catch(() => undefined);
      await page.waitForTimeout(750);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Expected editor save state to settle after reload recovery.");
}

async function waitForDomainPostPersistence(input: {
  siteId: string;
  domainKey: string;
  postId: string;
  title?: string;
  slug?: string;
  contentIncludes?: string;
  published?: boolean;
  taxonomyTerms?: Array<{ taxonomy: string; name: string }>;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await getSiteDomainPostById({
      siteId: input.siteId,
      dataDomainKey: input.domainKey,
      postId: input.postId,
    });
    const titleOk = input.title === undefined || record?.title === input.title;
    const slugOk = input.slug === undefined || record?.slug === input.slug;
    const contentOk =
      input.contentIncludes === undefined || String(record?.content || "").includes(input.contentIncludes);
    const publishedOk = input.published === undefined || Boolean(record?.published) === input.published;
    let taxonomyOk = input.taxonomyTerms === undefined;
    if (record && input.taxonomyTerms && input.taxonomyTerms.length > 0) {
      const { termsTable, termTaxonomiesTable, termRelationshipsTable } = getSiteTaxonomyTables(input.siteId);
      const taxonomyRows = await db
        .select({
          taxonomy: termTaxonomiesTable.taxonomy,
          name: termsTable.name,
        })
        .from(termRelationshipsTable)
        .innerJoin(termTaxonomiesTable, eq(termRelationshipsTable.termTaxonomyId, termTaxonomiesTable.id))
        .innerJoin(termsTable, eq(termTaxonomiesTable.termId, termsTable.id))
        .where(eq(termRelationshipsTable.objectId, input.postId));
      taxonomyOk = input.taxonomyTerms.every((term) =>
        taxonomyRows.some((row) => row.taxonomy === term.taxonomy && row.name === term.name),
      );
    }
    if (record && titleOk && slugOk && contentOk && publishedOk && taxonomyOk) {
      return record;
    }
    await pageDelay(500);
  }
  throw new Error(
    `Timed out waiting for persisted domain post ${input.postId} in ${input.domainKey} for site ${input.siteId}.`,
  );
}

async function waitForVisibleTextWithReload(page: Page, text: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await page.getByText(text).first().isVisible().catch(() => false);
    if (visible) return;
    await page.reload();
    await page.waitForTimeout(750);
  }
  throw new Error(`Timed out waiting for visible text: ${text}`);
}

async function waitForEditorFieldValueWithReload(
  page: Page,
  locator: Locator,
  expected: string,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  let cycle = 0;
  while (Date.now() < deadline) {
    cycle += 1;
    const settleDeadline = Math.min(deadline, Date.now() + 8_000);
    while (Date.now() < settleDeadline) {
      const actual = await locator.inputValue().catch(() => "");
      if (actual === expected) return;
      await page.waitForTimeout(400);
    }
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await waitForEditorSurface(page, 60_000, { requireEditable: true });
    await page.waitForTimeout(1_500);
  }
  await expect(locator).toHaveValue(expected, { timeout: 1000 });
}

async function waitForPublicPageText(
  page: Page,
  url: string,
  expectedText: string,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await page.goto(url);
      if (response?.status() === 200) {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (
          bodyText.includes(expectedText) &&
          !bodyText.includes("Application error: a client-side exception has occurred")
        ) {
          return response;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes("Could not connect to the server") &&
        !message.includes("net::ERR_CONNECTION_REFUSED") &&
        !message.includes("NS_ERROR_CONNECTION_REFUSED")
      ) {
        throw error;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for public page ${url} to contain ${expectedText}.`);
}

async function waitForPublicStatus(
  page: Page,
  url: string,
  expectedStatus: number,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await page.goto(url);
      if (response?.status() === expectedStatus) {
        return response;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes("Could not connect to the server") &&
        !message.includes("net::ERR_CONNECTION_REFUSED") &&
        !message.includes("NS_ERROR_CONNECTION_REFUSED")
      ) {
        throw error;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for public page ${url} to return ${expectedStatus}.`);
}

async function waitForEnabledButtonWithReload(page: Page, name: RegExp | string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button = page.getByRole("button", { name }).first();
    const visible = await button.isVisible().catch(() => false);
    const enabled = visible ? await button.isEnabled().catch(() => false) : false;
    if (visible && enabled) return;
    await page.reload();
    await page.waitForTimeout(750);
  }
  throw new Error(`Timed out waiting for enabled button ${String(name)} on ${page.url()}`);
}

async function waitForMenuEditorState(
  page: Page,
  url: string,
  expected: { location?: string; key?: string },
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await gotoAdminPage(page, url);
    const editMenuSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Edit Menu" }),
    });
    await expect(editMenuSection).toBeVisible({ timeout: 20_000 });
    const currentLocation = await editMenuSection.locator('select[name="location"]').inputValue().catch(() => "");
    const currentKey = await editMenuSection.locator('input[name="key"]').inputValue().catch(() => "");
    const locationMatches = expected.location ? currentLocation === expected.location : true;
    const keyMatches = expected.key ? currentKey === expected.key : true;
    if (locationMatches && keyMatches) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for menu editor state on ${url}`);
}

function pageDelay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEditorSurface(
  page: Page,
  timeoutMs = 60_000,
  options?: { requireEditable?: boolean },
) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let lastKnownUrl = page.url();
  const requireEditable = Boolean(options?.requireEditable);
  while (Date.now() < deadline) {
    const activeUrl = page.url();
    if (activeUrl && !activeUrl.startsWith("chrome-error://")) {
      lastKnownUrl = activeUrl;
    } else if (lastKnownUrl) {
      await page.goto(lastKnownUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1000);
      continue;
    }
    const titlePlaceholderVisible = await page.getByPlaceholder("Title").isVisible().catch(() => false);
    const titleTextboxVisible = await page.getByRole("textbox", { name: "Title" }).isVisible().catch(() => false);
    const saveButtonVisible = await page.getByRole("button", { name: "Save Changes" }).isVisible().catch(() => false);
    const slugTextboxVisible = await page.locator("#post-slug").isVisible().catch(() => false);
    const readOnlyVisible = await page
      .getByText("Read-only: you can view content but cannot modify this post.")
      .isVisible()
      .catch(() => false);
    const titleEditable = titlePlaceholderVisible
      ? await page.getByPlaceholder("Title").isEditable().catch(() => false)
      : titleTextboxVisible
        ? await page.getByRole("textbox", { name: "Title" }).isEditable().catch(() => false)
        : false;
    const editorReady = titlePlaceholderVisible || titleTextboxVisible || (saveButtonVisible && slugTextboxVisible);
    if (editorReady && (!requireEditable || (titleEditable && !readOnlyVisible))) {
      return;
    }
    const siteMissingVisible = await page
      .getByText("Site does not exist, or you do not have permission to view it")
      .isVisible()
      .catch(() => false);
    const notFoundVisible = await page.getByRole("heading", { name: "404" }).isVisible().catch(() => false);
    const pendingHydrationVisible = await page.getByText("Preparing editor").isVisible().catch(() => false);
    const currentUrl = new URL(lastKnownUrl);
    const isAdminItemRoute = /\/app\/(?:cp\/)?site\/[^/]+\/domain\/[^/]+\/item\/[^/?]+$/.test(currentUrl.pathname);
    if (siteMissingVisible || notFoundVisible) {
      const shouldEnterPendingHydration =
        !currentUrl.searchParams.has("pending") &&
        isAdminItemRoute;
      if (shouldEnterPendingHydration) {
        currentUrl.searchParams.set("pending", "1");
        await page.goto(currentUrl.toString(), { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page.waitForTimeout(1000);
        continue;
      }
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    } else if (pendingHydrationVisible || page.url().includes("pending=1")) {
      // The pending hydration page already auto-refreshes and normalizes the
      // URL. Extra test-driven reloads can starve eventual-consistency recovery.
      await page.waitForTimeout(1000);
    } else if ((isAdminItemRoute || (requireEditable && readOnlyVisible)) && Date.now() - startedAt >= 5_000) {
      currentUrl.searchParams.set("pending", "1");
      await page.goto(currentUrl.toString(), { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for editor surface on ${page.url()}`);
}

async function openMoreSidebar(page: Page) {
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await expect(page.getByText("Organize")).toBeVisible({ timeout: 20_000 });
}

async function waitForMenuRowLocation(page: Page, title: string, location: "footer" | "header") {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const row = page.locator("tr", { hasText: title }).first();
    const rowVisible = await row.isVisible().catch(() => false);
    if (rowVisible) {
      const text = (await row.textContent().catch(() => "")) || "";
      if (text.toLowerCase().includes(location)) return;
    }
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  await expect(page.locator("tr", { hasText: title }).first()).toContainText(location, { timeout: 1000 });
}

function taxonomySection(page: Page, label: "Category" | "Tags") {
  return page.locator("div.rounded-md.border.border-stone-200.bg-stone-50.p-2").filter({
    has: page.getByText(new RegExp(`^${label}$`, "i")),
  }).first();
}

async function setTaxonomyValue(page: Page, label: "Category" | "Tags", value: string) {
  const section = taxonomySection(page, label);
  await expect(section).toBeVisible({ timeout: 20_000 });
  await section.scrollIntoViewIfNeeded().catch(() => undefined);
  const deadline = Date.now() + 90_000;
  let stalledIterations = 0;
  while (Date.now() < deadline) {
    const sectionVisible = await section.isVisible().catch(() => false);
    if (!sectionVisible) {
      await openMoreSidebar(page).catch(() => undefined);
      await page.waitForTimeout(300);
      continue;
    }
    const selectedChip = section.locator(`button[title="Remove ${value}"]`).first();
    const selectedChipByName = section.getByRole("button", { name: new RegExp(`^${escapeRegExp(value)}\\s+×$`) }).first();
    const savingButton = section.getByRole("button", { name: "Saving..." }).first();
    const savingVisible = await savingButton.isVisible().catch(() => false);
    const selectedChipVisible = await selectedChip.isVisible().catch(() => false);
    const selectedChipByNameVisible = await selectedChipByName.isVisible().catch(() => false);
    if (selectedChipVisible || selectedChipByNameVisible) {
      return;
    }
    if (savingVisible) {
      stalledIterations += 1;
      if (stalledIterations >= 3) {
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
        await waitForEditorSurface(page, 60_000, { requireEditable: true }).catch(() => undefined);
        await openMoreSidebar(page);
        stalledIterations = 0;
      } else {
        await waitForEditorSavedWithReload(page, 30_000).catch(() => undefined);
      }
      await page.waitForTimeout(300);
      continue;
    }
    stalledIterations = 0;
    const selectedChips = section.locator('button[title^="Remove "]');
    const selectedCount = await selectedChips.count().catch(() => 0);
    let removedDifferentSelection = false;
    for (let index = 0; index < selectedCount; index += 1) {
      const chip = selectedChips.nth(index);
      const title = String((await chip.getAttribute("title").catch(() => "")) || "");
      if (!title || title === `Remove ${value}`) continue;
      await chip.scrollIntoViewIfNeeded().catch(() => undefined);
      await chip.click({ force: true }).catch(() => undefined);
      removedDifferentSelection = true;
      await page.waitForTimeout(300);
    }
    if (removedDifferentSelection) {
      await waitForEditorSavedWithReload(page, 30_000).catch(() => undefined);
      continue;
    }
    const availableChip = section
      .getByRole("button", { name: new RegExp(`^${escapeRegExp(value)}$`) })
      .first();
    const availableChipVisible = await availableChip.isVisible().catch(() => false);
    if (availableChipVisible) {
      await availableChip.scrollIntoViewIfNeeded().catch(() => undefined);
      await availableChip.click().catch(async () => {
        await availableChip.click({ force: true });
      });
      const selectionSettled = await expect
        .poll(
          async () => {
            const chipVisible = await selectedChip.isVisible().catch(() => false);
            const namedChipVisible = await selectedChipByName.isVisible().catch(() => false);
            const savingNow = await section.getByRole("button", { name: "Saving..." }).first().isVisible().catch(() => false);
            if ((chipVisible || namedChipVisible) && !savingNow) return "selected";
            return savingNow ? "saving" : "pending";
          },
          {
            timeout: 30_000,
            message: `Expected ${label} taxonomy chip ${value} to finish saving`,
          },
        )
        .toMatch(/selected/)
        .then(() => true)
        .catch(() => false);
      if (!selectionSettled) {
        await page.waitForTimeout(500);
        continue;
      }
      return;
    }
    const input = section.getByPlaceholder("Type to search or add");
    const selectButton = section.getByRole("button", { name: /Select|Saving.../i });
    const loadingButton = section.getByRole("button", { name: "Loading..." }).first();
    const inputDisabled = await input.isDisabled().catch(() => true);
    const buttonDisabled = await selectButton.isDisabled().catch(() => true);
    const loadingVisible = await loadingButton.isVisible().catch(() => false);
    if (inputDisabled || buttonDisabled || loadingVisible) {
      stalledIterations += 1;
      await page.waitForTimeout(stalledIterations >= 3 ? 1000 : 500);
      continue;
    }
    stalledIterations = 0;
    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.click({ force: true });
    await input.fill("");
    await input.fill(value);
    await expect(input).toHaveValue(value, { timeout: 5_000 });
    const buttonVisible = await selectButton.isVisible().catch(() => false);
    if (buttonVisible) {
      await selectButton.click({ force: true }).catch(() => undefined);
    } else {
      await input.press("Enter").catch(() => undefined);
    }
    const writeSettled = await expect
      .poll(
        async () => {
          const chipVisible = await selectedChip.isVisible().catch(() => false);
          const namedChipVisible = await selectedChipByName.isVisible().catch(() => false);
          const savingNow = await section.getByRole("button", { name: "Saving..." }).first().isVisible().catch(() => false);
          if ((chipVisible || namedChipVisible) && !savingNow) return "selected";
          if (savingNow) return "saving";
          const inputNowDisabled = await input.isDisabled().catch(() => false);
          return inputNowDisabled ? "disabled" : "pending";
        },
        {
          timeout: 30_000,
          message: `Expected ${label} taxonomy write for ${value} to finish`,
        },
      )
      .toMatch(/selected/)
      .then(() => true)
      .catch(() => false);
    if (!writeSettled) {
      await page.waitForTimeout(500);
      continue;
    }
    return;
  }
  throw new Error(`Timed out preparing ${label} taxonomy value ${value}.`);
}

async function expectSelectedTaxonomyChip(
  page: Page,
  label: "Category" | "Tags",
  value: string,
  options?: { reloadOnMiss?: boolean },
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const section = taxonomySection(page, label);
    const sectionVisible = await section.isVisible().catch(() => false);
    if (!sectionVisible) {
      await openMoreSidebar(page).catch(() => undefined);
      if (options?.reloadOnMiss) {
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
        await waitForEditorSurface(page, 60_000, { requireEditable: true });
        await openMoreSidebar(page);
      } else {
        await page.waitForTimeout(500);
      }
      continue;
    }
    const chip = section.locator(`button[title="Remove ${value}"]`).first();
    const namedChip = section.getByRole("button", { name: new RegExp(`^${escapeRegExp(value)}\\s+×$`) }).first();
    const savingVisible = await section.getByRole("button", { name: "Saving..." }).first().isVisible().catch(() => false);
    const chipVisible = await chip.isVisible().catch(() => false);
    const namedChipVisible = await namedChip.isVisible().catch(() => false);
    if ((chipVisible || namedChipVisible) && !savingVisible) {
      return;
    }
    if (savingVisible) {
      await waitForEditorSaved(page).catch(() => undefined);
    }
    if (options?.reloadOnMiss) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await waitForEditorSurface(page, 60_000, { requireEditable: true });
      await openMoreSidebar(page);
    }
    await page.waitForTimeout(500);
  }
  const section = taxonomySection(page, label);
  await expect(section).toBeVisible({ timeout: 1000 });
  const chip = section.locator(`button[title="Remove ${value}"]`).first();
  const namedChip = section.getByRole("button", { name: new RegExp(`^${escapeRegExp(value)}(?:\\s+×)?$`) }).first();
  const chipVisible = await chip.isVisible().catch(() => false);
  const namedChipVisible = await namedChip.isVisible().catch(() => false);
  if (chipVisible) {
    await expect(chip).toBeVisible({ timeout: 1000 });
    return;
  }
  await expect(namedChip).toBeVisible({ timeout: 1000 });
}

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureLifecycleTaxonomySelection(siteId: string, scope: string) {
  const categoryName = `Lifecycle Category ${scope}`;
  const tagName = `Lifecycle Tag ${scope}`;
  const updatedCategoryName = `Lifecycle Category Updated ${scope}`;
  const updatedTagName = `Lifecycle Tag Updated ${scope}`;
  await ensureSiteTaxonomyTables(siteId);
  await ensureLifecycleTaxonomyTerm(siteId, "category", categoryName);
  await ensureLifecycleTaxonomyTerm(siteId, "tag", tagName);
  await ensureLifecycleTaxonomyTerm(siteId, "category", updatedCategoryName);
  await ensureLifecycleTaxonomyTerm(siteId, "tag", updatedTagName);
  return { categoryName, tagName, updatedCategoryName, updatedTagName };
}

async function ensureLifecycleTaxonomyTerm(
  siteId: string,
  taxonomy: "category" | "tag",
  name: string,
) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error(`Cannot create empty ${taxonomy} term.`);
  }
  const slug =
    normalizedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `term-${Date.now()}`;
  const { termsTable, termTaxonomiesTable } = getSiteTaxonomyTables(siteId);
  return withLifecycleDbRetry(async () => {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: termTaxonomiesTable.id,
          name: termsTable.name,
        })
        .from(termTaxonomiesTable)
        .innerJoin(termsTable, eq(termTaxonomiesTable.termId, termsTable.id))
        .where(and(eq(termTaxonomiesTable.taxonomy, taxonomy), eq(termsTable.slug, slug)))
        .limit(1);
      if (existing) return existing;

      let [term] = await tx.select().from(termsTable).where(eq(termsTable.slug, slug)).limit(1);
      if (!term) {
        const [createdTerm] = await tx
          .insert(termsTable)
          .values({
            name: normalizedName,
            slug,
          })
          .onConflictDoNothing()
          .returning();
        term =
          createdTerm ||
          (await tx.select().from(termsTable).where(eq(termsTable.slug, slug)).limit(1))[0];
      }
      if (!term) {
        throw new Error(`Failed to create ${taxonomy} term ${normalizedName}.`);
      }

      let taxonomyRow:
        | {
            id: number;
            termId: number;
            taxonomy: string;
          }
        | undefined;
      try {
        [taxonomyRow] = await tx
          .insert(termTaxonomiesTable)
          .values({
            termId: term.id,
            taxonomy,
            parentId: null,
          })
          .onConflictDoNothing()
          .returning();
      } catch (error: any) {
        if (String(error?.code || "") !== "23503") {
          throw error;
        }
        term = (await tx.select().from(termsTable).where(eq(termsTable.slug, slug)).limit(1))[0];
        if (!term) {
          throw error;
        }
        [taxonomyRow] = await tx
          .insert(termTaxonomiesTable)
          .values({
            termId: term.id,
            taxonomy,
            parentId: null,
          })
          .onConflictDoNothing()
          .returning();
      }

      if (taxonomyRow) {
        return { id: taxonomyRow.id, name: term.name };
      }

      const [existingTaxonomy] = await tx
        .select({
          id: termTaxonomiesTable.id,
          name: termsTable.name,
        })
        .from(termTaxonomiesTable)
        .innerJoin(termsTable, eq(termTaxonomiesTable.termId, termsTable.id))
        .where(and(eq(termTaxonomiesTable.taxonomy, taxonomy), eq(termsTable.slug, slug)))
        .limit(1);
      if (!existingTaxonomy) {
        throw new Error(`Failed to create ${taxonomy} taxonomy row for ${normalizedName}.`);
      }
      return existingTaxonomy;
    });
  });
}

function isLifecycleTransientDbError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return code === "40P01" || code === "55P03" || message.includes("lock timeout");
}

async function withLifecycleDbRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isLifecycleTransientDbError(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

function projectKey(projectName: string) {
  return String(projectName || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
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
    slug: `${scopedRunId}-slide-one`,
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
    slug: `${scopedRunId}-slide-two`,
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
  configureLifecycleScope(projectKey(testInfo.project.name));
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
      email: `${scopedRunId}@example.com`,
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
      subdomain: `${scopedRunId}-secondary`,
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
      key: "_view_count",
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

test("site lifecycle: admin landing reflects seeded content for the active mode", async ({ page }) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/cp`);

  const articleEditorLink = page.locator(`a[href="/app/site/${primarySiteId}/domain/post/item/${articleId}"]`).first();
  const landedOnSiteDashboard = page.url().includes(`/app/site/${primarySiteId}`);

  if (landedOnSiteDashboard) {
    await expect(page.getByRole("heading", { name: "Lifecycle Primary Site Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Newest Articles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Most Popular Articles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All Articles" })).toBeVisible();
    await expect(articleEditorLink).toBeVisible({ timeout: 45_000 });
  } else {
    await expect(page.getByRole("heading", { name: "Network Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Newest Articles (Network)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Most Popular Articles (Network)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
    await expect(articleEditorLink).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Lifecycle Primary Site").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(`a[href="/app/site/${primarySiteId}"]`).first()).toBeVisible({ timeout: 45_000 });
  }

  await expectPageStable(page);
});

test("site lifecycle: site dashboard renders seeded content links", async ({ page }) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}`);

  await expect(page.getByRole("heading", { name: "Lifecycle Primary Site Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Newest Articles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most Popular Articles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All Articles" })).toBeVisible();
  const articleEditorLink = page.locator(`a[href="/app/site/${primarySiteId}/domain/post/item/${articleId}"]`).first();
  await expect(articleEditorLink).toBeVisible();
  await expect(page.locator(`a[href="/app/site/${primarySiteId}/domain/page/item/${pageId}"]`).first()).toBeVisible();
  await expectPageStable(page);

  const articleEditorHref = await articleEditorLink.getAttribute("href");
  if (!articleEditorHref) {
    throw new Error("Lifecycle article editor link did not expose an href.");
  }
  expect(articleEditorHref).toContain(`/app/site/${primarySiteId}/domain/post/item/${articleId}`);
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

  const mainNavigationRow = page.locator("tr", { hasText: "Main Navigation" }).first();
  const mainNavigationHref = await mainNavigationRow
    .locator('a[href*="/settings/menus?menu="]')
    .first()
    .getAttribute("href");
  if (!mainNavigationHref) {
    throw new Error("Main Navigation row did not expose a menu detail href.");
  }

  await gotoAdminPage(page, `${appOrigin}${mainNavigationHref}`);
  await expect(page.getByRole("heading", { name: "Main Navigation", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Menu Items" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Welcome Seeded lifecycle menu item/i })).toBeVisible();
  await expectPageStable(page);

  const editMenuItemLink = page.getByRole("link", { name: "Edit menu item Welcome" }).first();
  await expect(editMenuItemLink).toBeVisible({ timeout: 20_000 });
  const editMenuItemHref = await editMenuItemLink.getAttribute("href");
  if (!editMenuItemHref) {
    throw new Error("Seeded Welcome menu item did not expose an edit href.");
  }

  await gotoAdminPage(page, `${appOrigin}${editMenuItemHref}`);
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

test("site lifecycle: article editor supports create, edit, taxonomy, scheduling, publish, and public verification", async ({
  page,
}, testInfo) => {
  test.setTimeout(12 * 60 * 1000);
  console.log(`[lifecycle:${testInfo.project.name}] start article editor lifecycle`);
  await authenticateAsAdmin(page);
  const scope = projectKey(testInfo.project.name);
  const initialTitle = `Lifecycle Draft Article ${scope}`;
  const initialDescription = `Lifecycle draft article description (${scope}).`;
  const initialSlug = `${runId}-${scope}-draft-article`;
  const updatedTitle = `Lifecycle Updated Article ${scope}`;
  const updatedDescription = `Lifecycle updated article description (${scope}).`;
  const updatedSlug = `${runId}-${scope}-updated-article`;
  const {
    categoryName,
    tagName,
    updatedCategoryName,
    updatedTagName,
  } = await ensureLifecycleTaxonomySelection(primarySiteId, scope);

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/domain/post/create`);
  console.log(`[lifecycle:${testInfo.project.name}] opened create route`);

  await expectCurrentUrlToMatch(
    page,
    new RegExp(`/app/(?:cp/)?site/${primarySiteId}/domain/post/item/[^/?]+(?:\\?(?:pending=1|new=1))?$`),
    30_000,
  );
  const createdUrl = new URL(page.url());
  const createdPostId = createdUrl.pathname.split("/").pop() || "";
  expect(createdPostId).toBeTruthy();
  console.log(`[lifecycle:${testInfo.project.name}] created post shell ${createdPostId}`);
  // Draft creation redirects through the pending editor shell. Under pooled
  // reads, user-facing convergence is the contract we care about here rather
  // than an immediate out-of-band DB read from the test process.
  await waitForEditorSurface(page, 180_000, { requireEditable: true });
  const editor = page.locator(".ProseMirror").first();

  await page.getByPlaceholder("Title").fill(initialTitle);
  await page.getByPlaceholder("Description").fill(initialDescription);
  await page.locator("#post-slug").fill(initialSlug);
  await editor.click();
  await page.keyboard.type("Lifecycle article body.");

  console.log(`[lifecycle:${testInfo.project.name}] waiting for initial autosave settle`);
  await waitForEditorSaved(page);
  console.log(`[lifecycle:${testInfo.project.name}] waiting for temp draft materialization`);
  await waitForDomainPostPersistence({
    siteId: primarySiteId,
    domainKey: "post",
    postId: createdPostId,
    title: initialTitle,
  });
  console.log(`[lifecycle:${testInfo.project.name}] initial body/title save settled`);
  await openMoreSidebar(page);
  console.log(`[lifecycle:${testInfo.project.name}] opened More sidebar for initial taxonomy`);
  await setTaxonomyValue(page, "Category", categoryName);
  console.log(`[lifecycle:${testInfo.project.name}] selected initial category ${categoryName}`);
  await setTaxonomyValue(page, "Tags", tagName);
  console.log(`[lifecycle:${testInfo.project.name}] selected initial tag ${tagName}`);
  console.log(`[lifecycle:${testInfo.project.name}] running explicit save after initial taxonomy`);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await waitForEditorSaved(page);
  console.log(`[lifecycle:${testInfo.project.name}] waiting for initial taxonomy persistence`);
  await waitForDomainPostPersistence({
    siteId: primarySiteId,
    domainKey: "post",
    postId: createdPostId,
    title: initialTitle,
    slug: initialSlug,
    contentIncludes: "Lifecycle article body.",
    taxonomyTerms: [
      { taxonomy: "category", name: categoryName },
      { taxonomy: "tag", name: tagName },
    ],
  });
  console.log(`[lifecycle:${testInfo.project.name}] initial taxonomy persisted`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForEditorSurface(page, 90_000, { requireEditable: true });
  await openMoreSidebar(page);
  await expectSelectedTaxonomyChip(page, "Category", categoryName);
  await expectSelectedTaxonomyChip(page, "Tags", tagName);

  await gotoAdminPage(
    page,
    `${appOrigin}/app/site/${primarySiteId}/domain/post/item/${createdPostId}`,
  );
  await waitForEditorSurface(page, 90_000, { requireEditable: true });
  await waitForEditorFieldValueWithReload(page, page.getByPlaceholder("Title"), initialTitle);
  await waitForEditorFieldValueWithReload(page, page.locator("#post-slug"), initialSlug);
  console.log(`[lifecycle:${testInfo.project.name}] reopened editor with initial values`);
  await expect(editor).toContainText("Lifecycle article body.");
  await openMoreSidebar(page);
  await expect(taxonomySection(page, "Category")).toBeVisible();
  await expect(taxonomySection(page, "Tags")).toBeVisible();

  await page.getByPlaceholder("Title").fill(updatedTitle);
  await page.getByPlaceholder("Description").fill(updatedDescription);
  await page.locator("#post-slug").fill(updatedSlug);
  await editor.click();
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+A`);
  await page.keyboard.type("Lifecycle updated article body.");

  await waitForEditorSaved(page);
  await openMoreSidebar(page);
  await setTaxonomyValue(page, "Category", updatedCategoryName);
  await setTaxonomyValue(page, "Tags", updatedTagName);
  await waitForEditorSavedWithReload(page);
  await waitForDomainPostPersistence({
    siteId: primarySiteId,
    domainKey: "post",
    postId: createdPostId,
    taxonomyTerms: [
      { taxonomy: "category", name: updatedCategoryName },
      { taxonomy: "tag", name: updatedTagName },
    ],
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForEditorSurface(page, 90_000, { requireEditable: true });
  await openMoreSidebar(page);
  await expectSelectedTaxonomyChip(page, "Category", updatedCategoryName);
  await expectSelectedTaxonomyChip(page, "Tags", updatedTagName);

  const futureDate = new Date(Date.now() + 60 * 60 * 1000);
  const futureLocal = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}T${String(futureDate.getHours()).padStart(2, "0")}:${String(futureDate.getMinutes()).padStart(2, "0")}`;
  await page.getByRole("button", { name: /^Schedule publish:/ }).click();
  await page.locator('input[type="datetime-local"]').fill(futureLocal);
  await page.getByRole("button", { name: "Save Schedule" }).click();
  await expect(page.getByRole("dialog", { name: "Schedule publish" })).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Schedule publish:/ })).not.toHaveText("Publish: immediately", { timeout: 20_000 });
  await waitForEditorSavedWithReload(page);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await waitForEditorSaved(page);
  await waitForEnabledButtonWithReload(page, /^Publish$/);
  await page.getByRole("button", { name: /^Publish$/ }).click();
  await waitForEditorSaved(page);

  const publicPage = await page.context().newPage();
  const scheduledResponse = await waitForPublicStatus(
    publicPage,
    `${primaryPublicUrl}/post/${updatedSlug}`,
    404,
  );
  expect(scheduledResponse?.status()).toBe(404);
  await publicPage.close();

  await page.getByRole("button", { name: /^Schedule publish:/ }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "Save Schedule" }).click();
  await expect(page.getByRole("dialog", { name: "Schedule publish" })).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Schedule publish:/ })).toHaveText("Publish: immediately", { timeout: 20_000 });
  await waitForEditorSavedWithReload(page);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await waitForEditorSaved(page);
  await waitForEnabledButtonWithReload(page, /^Publish$/);
  await page.getByRole("button", { name: /^Publish$/ }).click();
  await waitForEditorSaved(page);
  await waitForDomainPostPersistence({
    siteId: primarySiteId,
    domainKey: "post",
    postId: createdPostId,
    title: updatedTitle,
    slug: updatedSlug,
    contentIncludes: "Lifecycle updated article body.",
    published: true,
  });

  const verifyPage = await page.context().newPage();
  const oldSlugResponse = await waitForPublicStatus(
    verifyPage,
    `${primaryPublicUrl}/post/${initialSlug}`,
    404,
  );
  expect(oldSlugResponse?.status()).toBe(404);
  const publishedResponse = await waitForPublicPageText(verifyPage, `${primaryPublicUrl}/post/${updatedSlug}`, updatedTitle);
  expect(publishedResponse?.status()).toBe(200);
  await expect(verifyPage.locator("body")).toContainText("Lifecycle updated article body.");
  await verifyPage.close();

  await gotoAdminPage(
    page,
    `${appOrigin}/app/site/${primarySiteId}/domain/post/item/${createdPostId}`,
  );
  await waitForEditorSurface(page, 90_000, { requireEditable: true });
  await expect(page.getByPlaceholder("Title")).toHaveValue(updatedTitle);
  await expect(page.locator("#post-slug")).toHaveValue(updatedSlug);
  await expect(editor).toContainText("Lifecycle updated article body.");
});

test("site lifecycle: page editor persists title and permalink updates", async ({ page }) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/domain/page/item/${pageId}`);
  await waitForEditorSurface(page, 60_000, { requireEditable: true });
  await expect(page.getByPlaceholder("Title")).toHaveValue("Lifecycle About Page");
  await expect(page.locator("#post-slug")).toHaveValue(pageSlug);

  const updatedPageTitle = "About Robert Betan";
  const updatedPageSlug = "about-robert-betan";

  await page.getByPlaceholder("Title").fill(updatedPageTitle);
  await page.locator("#post-slug").fill(updatedPageSlug);
  await expect(page.getByPlaceholder("Title")).toHaveValue(updatedPageTitle);
  await expect(page.locator("#post-slug")).toHaveValue(updatedPageSlug);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await waitForEditorSaved(page);
  await waitForDomainPostPersistence({
    siteId: primarySiteId,
    domainKey: "page",
    postId: pageId,
    title: updatedPageTitle,
    slug: updatedPageSlug,
    published: true,
  });

  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/domain/page/item/${pageId}`);
  await waitForEditorSurface(page, 60_000);
  await expect(page.getByPlaceholder("Title")).toHaveValue(updatedPageTitle);
  await expect(page.locator("#post-slug")).toHaveValue(updatedPageSlug);

  const publicPage = await page.context().newPage();
  const oldPageResponse = await waitForPublicStatus(
    publicPage,
    `${primaryPublicUrl}/page/${pageSlug}`,
    404,
  );
  expect(oldPageResponse?.status()).toBe(404);
  const newPageResponse = await waitForPublicPageText(publicPage, `${primaryPublicUrl}/page/${updatedPageSlug}`, updatedPageTitle);
  expect(newPageResponse?.status()).toBe(200);
  await publicPage.close();
});

test("site lifecycle: menu location can move between footer and header", async ({ page }, testInfo) => {
  await authenticateAsAdmin(page);
  await gotoAdminPage(page, `${appOrigin}/app/site/${primarySiteId}/settings/menus?createMenu=1`);

  const scope = projectKey(testInfo.project.name);
  const lifecycleMenuTitle = `Lifecycle Footer Menu ${scope}`;
  const lifecycleMenuKey = `lifecycle-footer-menu-${scope}`;
  const createMenuSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Create Menu" }),
  });

  await createMenuSection.locator('input[name="title"]').fill(lifecycleMenuTitle);
  await createMenuSection.locator('input[name="key"]').fill(lifecycleMenuKey);
  await createMenuSection.locator('select[name="location"]').selectOption("footer");
  await createMenuSection.getByRole("button", { name: "Create Menu" }).click();
  await page.waitForURL(new RegExp(`/app/(?:cp/)?site/${primarySiteId}/settings/menus\\?menu=`), { timeout: 60_000 });
  const createdMenuId = new URL(page.url()).searchParams.get("menu") || "";
  expect(createdMenuId).not.toBe("");
  await expect(page.getByRole("heading", { name: lifecycleMenuTitle })).toBeVisible();
  await waitForMenuEditorState(
    page,
    `${appOrigin}/app/site/${primarySiteId}/settings/menus?menu=${encodeURIComponent(createdMenuId)}&editMenu=${encodeURIComponent(createdMenuId)}`,
    {
      location: "footer",
      key: lifecycleMenuKey,
    },
  );

  await page.getByRole("link", { name: "Edit Menu" }).click();
  await expect(page.getByRole("heading", { name: "Edit Menu" })).toBeVisible({ timeout: 45_000 });
  const editMenuSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Edit Menu" }),
  });
  await editMenuSection.locator('select[name="location"]').selectOption("header");
  await editMenuSection.getByRole("button", { name: "Save Menu" }).click();

  await gotoAdminPage(
    page,
    `${appOrigin}/app/site/${primarySiteId}/settings/menus?menu=${encodeURIComponent(createdMenuId)}&editMenu=${encodeURIComponent(createdMenuId)}`,
  );
  await waitForMenuEditorState(
    page,
    `${appOrigin}/app/site/${primarySiteId}/settings/menus?menu=${encodeURIComponent(createdMenuId)}&editMenu=${encodeURIComponent(createdMenuId)}`,
    {
      location: "header",
      key: lifecycleMenuKey,
    },
  );
});
