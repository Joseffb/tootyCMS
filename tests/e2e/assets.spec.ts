import { expect, test } from "@playwright/test";

test("@cross-browser icon endpoint serves toucan svg", async ({ request }) => {
  const port = String(process.env.TEST_PORT || "3000").trim();
  const response = await request.get(`http://127.0.0.1:${port}/icon.svg`);
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("Tooty the Toucan");
});
