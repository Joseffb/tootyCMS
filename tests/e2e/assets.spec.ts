import { expect, test } from "@playwright/test";

test("icon endpoint serves toucan svg", async ({ request }) => {
  const response = await request.get("/icon.svg");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("Tooty the Toucan");
});
