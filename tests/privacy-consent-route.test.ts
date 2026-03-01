import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAnalyticsSiteId: vi.fn(),
  listPluginsWithSiteState: vi.fn(),
}));

vi.mock("@/lib/analytics-site", () => ({
  resolveAnalyticsSiteId: mocks.resolveAnalyticsSiteId,
}));

vi.mock("@/lib/plugins", () => ({
  listPluginsWithSiteState: mocks.listPluginsWithSiteState,
}));

describe("GET /api/privacy/consent", () => {
  beforeEach(() => {
    mocks.resolveAnalyticsSiteId.mockReset();
    mocks.listPluginsWithSiteState.mockReset();
  });

  it("falls back to defaults during fresh install when site resolution throws", async () => {
    mocks.resolveAnalyticsSiteId.mockRejectedValue(new Error('relation "robertbetan_sites" does not exist'));

    const { GET } = await import("@/app/api/privacy/consent/route");
    const response = await GET(new Request("http://robertbetan.test/api/privacy/consent"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      bannerMessage: "We use anonymous analytics to improve this site.",
      acceptText: "Accept",
      declineText: "Decline",
      denyOnDismiss: true,
      declineCooldownDays: 1,
    });
    expect(mocks.listPluginsWithSiteState).not.toHaveBeenCalled();
  });

  it("falls back to defaults when site-scoped plugin lookup fails after site resolution", async () => {
    mocks.resolveAnalyticsSiteId.mockResolvedValue("site-1");
    mocks.listPluginsWithSiteState.mockRejectedValue(new Error("Invalid site."));

    const { GET } = await import("@/app/api/privacy/consent/route");
    const response = await GET(new Request("http://example.com/api/privacy/consent"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      bannerMessage: "We use anonymous analytics to improve this site.",
      acceptText: "Accept",
      declineText: "Decline",
      denyOnDismiss: true,
      declineCooldownDays: 1,
    });
  });
});
