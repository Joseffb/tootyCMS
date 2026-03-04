import { afterEach, describe, expect, it, vi } from "vitest";

describe("site url generation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps branded .test hosts on https without a dev port", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "robertbetan.test");
    vi.stubEnv("PORT", "3000");

    const { getRootSiteUrl, getSitePublicUrl } = await import("@/lib/site-url");

    expect(getRootSiteUrl()).toBe("https://robertbetan.test");
    expect(getSitePublicUrl({ isPrimary: true, subdomain: "main" })).toBe(
      "https://robertbetan.test",
    );
    expect(getSitePublicUrl({ subdomain: "axed" })).toBe(
      "https://axed.robertbetan.test",
    );
  });

  it("keeps localhost hosts on http with the dev port", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost");
    vi.stubEnv("PORT", "3000");

    const { getRootSiteUrl, getSitePublicUrl } = await import("@/lib/site-url");

    expect(getRootSiteUrl()).toBe("http://localhost:3000");
    expect(getSitePublicUrl({ subdomain: "demo" })).toBe(
      "http://demo.localhost:3000",
    );
  });
});
