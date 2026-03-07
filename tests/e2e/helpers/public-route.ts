import { expect, type Page } from "@playwright/test";

async function ensureOpenPage(page: Page) {
  return page.isClosed() ? page.context().newPage() : page;
}

async function replacePage(page: Page) {
  let replacement: Page;
  try {
    replacement = await page.context().newPage();
  } catch {
    throw new Error("Browser context closed during public page recovery.");
  }
  if (!page.isClosed()) {
    await page.close().catch(() => null);
  }
  return replacement;
}

function isRecoverableNavigationError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error);
  return (
    message.includes("ERR_ABORTED") ||
    message.includes("NS_BINDING_ABORTED") ||
    message.toLowerCase().includes("frame was detached") ||
    message.toLowerCase().includes("page closed") ||
    message.toLowerCase().includes("timeout")
  );
}

function shouldReplacePage(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes("err_aborted") ||
    message.includes("ns_binding_aborted") ||
    message.includes("frame was detached") ||
    message.includes("page closed")
  );
}

async function waitForPublicDomReady(page: Page) {
  await page.locator("body").first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
}

export async function gotoPublicTarget(page: Page, href: string, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  let activePage = page;

  while (Date.now() < deadline) {
    try {
      activePage = await ensureOpenPage(activePage);
      await activePage.goto(href, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await waitForPublicDomReady(activePage);
      return activePage;
    } catch (error) {
      lastError = error;
      if (!isRecoverableNavigationError(error)) {
        throw error;
      }
      if (shouldReplacePage(error)) {
        activePage = await replacePage(activePage);
      }
      await activePage.waitForTimeout(500).catch(() => null);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out navigating to ${href}`);
}

export async function ensureCommentsShellReady(page: Page, href: string, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let activePage = page;

  while (Date.now() < deadline) {
    activePage = await ensureOpenPage(activePage);
    const title = activePage.locator(".tooty-comments-title").first();
    const note = activePage.locator("[data-comments-note]").first();
    const visible = await title.isVisible().catch(() => false);
    const loading =
      visible &&
      (await note
        .textContent()
        .then((value) => /loading comments|retrying comments/i.test(String(value || "")))
        .catch(() => false));
    if (visible && !loading) return activePage;
    activePage = await gotoPublicTarget(activePage, href, 30_000).catch(() => activePage);
    await activePage.waitForTimeout(500).catch(() => null);
  }

  const title = activePage.locator(".tooty-comments-title").first();
  const note = activePage.locator("[data-comments-note]").first();
  await expect(title).toBeVisible({ timeout: 5_000 });
  await expect(note).not.toContainText(/loading comments|retrying comments/i, { timeout: 5_000 });
  return activePage;
}
