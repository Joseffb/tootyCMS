import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettingByKey: vi.fn(),
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingByKey: mocks.getSettingByKey,
}));

describe("getSiteThemeId", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSettingByKey.mockReset();
  });

  it("falls back to the default theme when the site was deleted mid-request", async () => {
    mocks.getSettingByKey.mockRejectedValue(new Error("Invalid site."));

    const { getSiteThemeId } = await import("@/lib/themes");
    await expect(getSiteThemeId("missing-site")).resolves.toBe("tooty-light");
  });

  it("rethrows non-site errors", async () => {
    mocks.getSettingByKey.mockRejectedValue(new Error("boom"));

    const { getSiteThemeId } = await import("@/lib/themes");
    await expect(getSiteThemeId("site-1")).rejects.toThrow("boom");
  });
});
