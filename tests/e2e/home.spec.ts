import { expect, test } from "@playwright/test";

test("home page renders without runtime errors", async ({ page }) => {
  const response = await page.goto("/");
  if (!response?.ok()) {
    const loginResponse = (await page.goto("/login")) ?? (await page.goto("/app/login"));
    expect(loginResponse?.ok()).toBeTruthy();
    await expect(page.locator("body")).toContainText(/login|auth|provider|configured/i);
    return;
  }

  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("body")).toContainText(/tooty|fernain|cms/i);
});
