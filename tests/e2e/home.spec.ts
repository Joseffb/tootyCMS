import { expect, test } from "@playwright/test";

test("home page renders without runtime errors", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();

  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("body")).toContainText(/tooty|fernain|cms/i);
});
