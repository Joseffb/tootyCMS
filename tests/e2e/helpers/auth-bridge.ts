import { expect, type Page } from "@playwright/test";
import { gotoPublicTarget } from "./public-route";

async function ensureOpenPage(page: Page) {
  return page.isClosed() ? page.context().newPage() : page;
}

async function replacePage(page: Page) {
  let replacement: Page;
  try {
    replacement = await page.context().newPage();
  } catch {
    throw new Error("Browser context closed during theme-bridge recovery.");
  }
  if (!page.isClosed()) {
    await page.close().catch(() => null);
  }
  return replacement;
}

function isRecoverableBridgeError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error);
  return (
    message.includes("ERR_ABORTED") ||
    message.includes("NS_BINDING_ABORTED") ||
    message.toLowerCase().includes("interrupted by another navigation") ||
    message.toLowerCase().includes("frame was detached") ||
    message.toLowerCase().includes("page closed") ||
    message.toLowerCase().includes("timeout")
  );
}

export async function gotoBridgeTarget(page: Page, href: string) {
  const expectedReturnUrl = (() => {
    try {
      return String(new URL(href).searchParams.get("return") || "").trim();
    } catch {
      return "";
    }
  })();
  let activePage = page;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      activePage = await ensureOpenPage(activePage);
      await activePage.goto(href, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch((error) => {
        if (isRecoverableBridgeError(error)) {
          return null;
        }
        throw error;
      });
      if (expectedReturnUrl) {
        await activePage
          .waitForURL((url) => url.toString().startsWith(expectedReturnUrl), {
            timeout: 20_000,
          })
          .catch(() => null);
      }
      return activePage;
    } catch (error) {
      if (!isRecoverableBridgeError(error) || attempt >= 3) {
        throw error;
      }
      activePage = await replacePage(activePage);
    }
  }
  return activePage;
}

export async function ensureFrontendBridgeAuth(
  page: Page,
  input: { displayName: string; expectedPublicUrl: string },
) {
  const { displayName, expectedPublicUrl } = input;
  let activePage = await ensureOpenPage(page);
  await activePage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (activePage.isClosed()) {
      activePage = await ensureOpenPage(activePage).catch(() => {
        throw new Error("Theme bridge browser context closed before authenticated greeting resolved.");
      });
      activePage = await gotoPublicTarget(activePage, expectedPublicUrl, 30_000).catch(() => activePage);
    }
    const authNode = activePage.locator(".tooty-post-auth, [data-theme-auth-greeting]").first();
    const loginLink = activePage.getByRole("link", { name: "Login" }).first();
    const greetingVisible = await authNode
      .filter({ hasText: `Hello ${displayName}` })
      .first()
      .isVisible()
      .catch(() => false);
    if (greetingVisible) break;

    const loginCount = await loginLink.count().catch(() => 0);
    if (loginCount > 0) {
      const loginVisible = await loginLink.isVisible().catch(() => false);
      if (loginVisible) {
        const href = await loginLink.getAttribute("href");
        if (href) {
          activePage = await gotoBridgeTarget(activePage, href);
        }
      }
    }

    const bridged = await activePage
      .waitForFunction(
        (expectedDisplayName) => {
          const auth = (window as any).__tootyFrontendAuth;
          if (auth?.token) return true;
          const raw = window.localStorage.getItem("tooty.themeAuthBridge.v1");
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (String(parsed?.token || "").trim()) return true;
            } catch {
              // Ignore transient malformed bridge payloads under concurrent writes.
            }
          }
          const authEl = document.querySelector(".tooty-post-auth, [data-theme-auth-greeting]");
          return Boolean(authEl?.textContent?.includes(`Hello ${expectedDisplayName}`));
        },
        displayName,
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);

    if (bridged && !activePage.isClosed()) {
      await activePage
        .waitForURL((url) => url.toString().startsWith(expectedPublicUrl), {
          timeout: 8_000,
        })
        .catch(() => null);
    }

    const refreshedGreetingVisible = await authNode
      .filter({ hasText: `Hello ${displayName}` })
      .first()
      .isVisible()
      .catch(() => false);
    if (refreshedGreetingVisible) break;

    activePage = await gotoPublicTarget(activePage, expectedPublicUrl, 30_000).catch(() => activePage);
    await activePage
      .evaluate(() => {
        const ping = (window as any).__tootyPingFrontendBridge;
        if (typeof ping === "function") {
          try {
            ping("silent");
          } catch {
            // Ignore bridge ping failures; the visibility assertion below is authoritative.
          }
        }
      })
      .catch(() => null);

    if (attempt < 2 && !activePage.isClosed()) {
      await activePage.waitForTimeout(750 * (attempt + 1)).catch(() => null);
    }
  }

  const authNode = activePage.locator(".tooty-post-auth, [data-theme-auth-greeting]").first();
  const greetingVisible = await authNode
    .filter({ hasText: `Hello ${displayName}` })
    .first()
    .isVisible()
    .catch(() => false);
  if (!greetingVisible) {
    activePage = await gotoPublicTarget(activePage, expectedPublicUrl, 20_000).catch(() => activePage);
  }

  await expect(authNode).toBeVisible({ timeout: 10_000 });
  await expect(authNode).toContainText(`Hello ${displayName}`, { timeout: 10_000 });
  return activePage;
}
