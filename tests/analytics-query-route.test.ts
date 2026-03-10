import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createKernelForRequest: vi.fn(),
  resolveAnalyticsSiteId: vi.fn(),
  execute: vi.fn(),
  quotedSiteDomainQueueTableName: vi.fn(),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/analytics-site", () => ({
  resolveAnalyticsSiteId: mocks.resolveAnalyticsSiteId,
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.execute,
  },
}));

vi.mock("@/lib/domain-queue", () => ({
  quotedSiteDomainQueueTableName: mocks.quotedSiteDomainQueueTableName,
}));

import { GET } from "@/app/api/analytics/query/route";

describe("GET /api/analytics/query", () => {
  beforeEach(() => {
    mocks.createKernelForRequest.mockReset();
    mocks.resolveAnalyticsSiteId.mockReset();
    mocks.execute.mockReset();
    mocks.quotedSiteDomainQueueTableName.mockReset();

    mocks.resolveAnalyticsSiteId.mockResolvedValue("site-1");
    mocks.quotedSiteDomainQueueTableName.mockReturnValue('"tooty_site_site_1_domain_events_queue"');
    mocks.createKernelForRequest.mockResolvedValue({
      applyFilters: vi.fn().mockResolvedValue(null),
    });
    mocks.execute.mockRejectedValue(new Error('relation "tooty_site_site_1_domain_events_queue" does not exist'));
  });

  it("does not bootstrap the legacy domain events queue during read-only analytics queries", async () => {
    const response = await GET(
      new Request("http://localhost/api/analytics/query?name=visitors_per_day"),
    );

    expect(response.status).toBe(200);
    expect(mocks.quotedSiteDomainQueueTableName).toHaveBeenCalledWith("site-1");

    const json = await response.json();
    expect(json.data).toEqual([]);
    expect(json.meta).toMatchObject({
      provider: null,
      fallback: true,
      reason: "no_analytics_provider",
    });
  });
});
