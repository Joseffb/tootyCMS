import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireSchedulerLock: vi.fn(),
  releaseSchedulerLock: vi.fn(),
  runDueNetworkSchedules: vi.fn(),
  runDueSiteSchedulesForAllEnabledSites: vi.fn(),
  processAllSiteDomainQueues: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("@/lib/scheduler", () => ({
  acquireSchedulerLock: mocks.acquireSchedulerLock,
  releaseSchedulerLock: mocks.releaseSchedulerLock,
  runDueNetworkSchedules: mocks.runDueNetworkSchedules,
  runDueSiteSchedulesForAllEnabledSites: mocks.runDueSiteSchedulesForAllEnabledSites,
}));

vi.mock("@/lib/domain-dispatch", () => ({
  processAllSiteDomainQueues: mocks.processAllSiteDomainQueues,
}));

vi.mock("@/lib/debug", () => ({
  trace: mocks.trace,
}));

import { POST } from "@/app/api/cron/run/route";

describe("POST /api/cron/run", () => {
  beforeEach(() => {
    mocks.acquireSchedulerLock.mockReset();
    mocks.releaseSchedulerLock.mockReset();
    mocks.runDueNetworkSchedules.mockReset();
    mocks.runDueSiteSchedulesForAllEnabledSites.mockReset();
    mocks.processAllSiteDomainQueues.mockReset();
    mocks.trace.mockReset();
    process.env.CRON_RUN_TOKEN = "test-token";
  });

  it("runs scheduled work and drains site queues before releasing the lock", async () => {
    mocks.acquireSchedulerLock.mockResolvedValue(true);
    mocks.runDueNetworkSchedules.mockResolvedValue({
      ran: 1,
      skipped: 0,
      blocked: 0,
      errors: 0,
      deadLettered: 0,
    });
    mocks.runDueSiteSchedulesForAllEnabledSites.mockResolvedValue({
      ran: 1,
      skipped: 0,
      blocked: 0,
      errors: 0,
      deadLettered: 0,
    });
    mocks.processAllSiteDomainQueues.mockResolvedValue({
      processed: 3,
      sitesChecked: 2,
    });
    mocks.releaseSchedulerLock.mockResolvedValue(undefined);

    const response = await POST(
      new Request("http://localhost/api/cron/run", {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runDueNetworkSchedules).toHaveBeenCalledWith(50);
    expect(mocks.runDueSiteSchedulesForAllEnabledSites).toHaveBeenCalledWith(25);
    expect(mocks.processAllSiteDomainQueues).toHaveBeenCalledWith(25);
    expect(mocks.releaseSchedulerLock).toHaveBeenCalledTimes(1);

    const json = await response.json();
    expect(json).toMatchObject({
      ok: true,
      ran: 2,
      domainQueueProcessed: 3,
      domainQueueSitesChecked: 2,
    });
    expect(json).toHaveProperty("networkSchedules");
    expect(json).toHaveProperty("siteSchedules");
  });
});
