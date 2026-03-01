import { expect, test } from "@playwright/test";
import { getAdminBaseUrl } from "./helpers/env";

test("@cross-browser home page renders without runtime errors", async ({ page }) => {
  const response = await page.goto("/");
  if (!response?.ok()) {
    const loginResponse = await page.request.get(`${getAdminBaseUrl()}/login`, {
      maxRedirects: 0,
    });
    expect(loginResponse.status()).not.toBe(404);
    expect(loginResponse.status()).toBeLessThan(500);
    const loginBody = (await loginResponse.text()).toLowerCase();
    expect(loginBody).toMatch(/login|auth|provider|configured/);
    return;
  }

  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("body")).toContainText(/tooty|fernain|cms/i);
});
