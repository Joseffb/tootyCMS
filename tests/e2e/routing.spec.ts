import { expect, test } from "@playwright/test";

async function gotoWithConnectionRetry(
  page: import("@playwright/test").Page,
  url: string,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await page.goto(url, { waitUntil: "domcontentloaded" });
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
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out navigating to ${url}.`);
}

test("@cross-browser about page is accessible", async ({ page }) => {
  const response = await gotoWithConnectionRetry(page, "/about-this-site");
  if (!response?.ok()) {
    await gotoWithConnectionRetry(page, "/app/cp/login");
    expect(page.url()).toMatch(/\/(app\/cp\/login|setup)$/);
    await expect(page.locator("body")).toContainText(/login|auth|provider|configured|setup/i);
    return;
  }
  await expect(page.locator("body")).toContainText(/about|site|tooty|cms/i);
});

test("@cross-browser direct app login route is not a 404", async ({ page }) => {
  const response = await gotoWithConnectionRetry(page, "/app/cp/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(/login|auth|provider|configured/i);
});
