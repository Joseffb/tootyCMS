import { expect, test } from "@playwright/test";

test("about page is accessible", async ({ page }) => {
  const response = await page.goto("/about-this-site");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("body")).toContainText(/about|site|tooty|cms/i);
});

test("direct app login route is not a 404", async ({ page }) => {
  const response = await page.goto("/app/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("button", { name: /login with github/i })).toBeVisible();
});
