import { expect, test } from "@playwright/test";

test("about page is accessible", async ({ page }) => {
  await page.goto("/about-this-site");
  await expect(page.getByRole("heading", { name: /about this site/i })).toBeVisible();
});

test("direct app login route is not a 404", async ({ page }) => {
  const response = await page.goto("/app/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("button", { name: /login with github/i })).toBeVisible();
});
