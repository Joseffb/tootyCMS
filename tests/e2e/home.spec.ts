import { expect, test } from "@playwright/test";

test("home page renders lively Tooty hero", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1", { hasText: /the cms that doesn.t fight your stack|shipping, reluctantly\./i })).toBeVisible();
  await expect(page.locator(".hero-kicker")).toHaveText(/tooty cms/i);
  await expect(page.getByRole("heading", { name: /latest content/i })).toBeVisible();
});
