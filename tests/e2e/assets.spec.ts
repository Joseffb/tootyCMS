import { expect, test } from "@playwright/test";

test("@cross-browser icon endpoint serves toucan svg", async ({ request }) => {
  const port = String(process.env.TEST_PORT || "3000").trim();
  const response = await request.get(`http://127.0.0.1:${port}/icon.svg`);
  expect(response.status()).toBe(200);
  const contentType = response.headers()["content-type"] || "";
  expect(contentType).toMatch(/^image\/(svg\+xml|png)/i);
  const body = await response.body();
  expect(body.byteLength).toBeGreaterThan(128);
});
