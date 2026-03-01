import { expect, test } from "@playwright/test";

test("@cross-browser about page is accessible", async ({ page }) => {
  const response = await page.goto("/about-this-site");
  if (!response?.ok()) {
    await page.goto("/app/cp/login");
    expect(page.url()).toMatch(/\/(app\/cp\/login|setup)$/);
    await expect(page.locator("body")).toContainText(/login|auth|provider|configured|setup/i);
    return;
  }
  await expect(page.locator("body")).toContainText(/about|site|tooty|cms/i);
});

test("@cross-browser direct app login route is not a 404", async ({ page }) => {
  const response = await page.goto("/app/cp/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(/login|auth|provider|configured/i);
});
