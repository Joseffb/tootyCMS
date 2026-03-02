import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettingByKey: vi.fn(),
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingByKey: mocks.getSettingByKey,
  setSettingByKey: vi.fn(),
}));

describe("site-scoped settings", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSettingByKey.mockReset();
  });

  it("returns fallback text when the site is deleted mid-request", async () => {
    mocks.getSettingByKey.mockRejectedValue(new Error("Invalid site."));

    const { getSiteTextSetting } = await import("@/lib/cms-config");
    await expect(getSiteTextSetting("missing-site", "seo_meta_title", "fallback")).resolves.toBe(
      "fallback",
    );
  });

  it("returns fallback boolean when the site is deleted mid-request", async () => {
    mocks.getSettingByKey.mockRejectedValue(new Error("Invalid site."));

    const { getSiteBooleanSetting } = await import("@/lib/cms-config");
    await expect(getSiteBooleanSetting("missing-site", "main_header_enabled", true)).resolves.toBe(
      true,
    );
  });
});
