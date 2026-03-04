import { afterEach, describe, expect, it, vi } from "vitest";

describe("theme dev mode helpers", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it("uses no-store theme assets in development", async () => {
    process.env.NODE_ENV = "development";

    const mod = await import("@/lib/theme-dev-mode");

    expect(mod.isThemeDevDynamicMode()).toBe(true);
    expect(mod.getThemeAssetCacheControlHeader()).toBe("no-store, no-cache, must-revalidate");
  });

  it("uses cacheable theme assets outside development", async () => {
    process.env.NODE_ENV = "production";

    const mod = await import("@/lib/theme-dev-mode");

    expect(mod.isThemeDevDynamicMode()).toBe(false);
    expect(mod.getThemeAssetCacheControlHeader()).toBe("public, max-age=3600, s-maxage=3600");
  });

  it("creates a per-request dev cache bust token", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1772600000000);
    const mod = await import("@/lib/theme-dev-mode");

    expect(mod.getThemeDevCacheBustToken()).toBe("1772600000000");
  });
});
