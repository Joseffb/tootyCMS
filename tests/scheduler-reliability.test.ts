import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getBooleanSetting: vi.fn(),
  getSiteUrlSetting: vi.fn(),
  getSiteUrlSettingForSite: vi.fn(),
  retryPendingCommunications: vi.fn(),
  purgeCommunicationQueue: vi.fn(),
  purgeWebcallbackEvents: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.execute,
  },
}));

vi.mock("@/lib/cms-config", () => ({
  SCHEDULES_ENABLED_KEY: "schedules_enabled",
  SCHEDULES_PING_SITEMAP_KEY: "schedules_ping_sitemap",
  getBooleanSetting: mocks.getBooleanSetting,
  getSiteUrlSetting: mocks.getSiteUrlSetting,
  getSiteUrlSettingForSite: mocks.getSiteUrlSettingForSite,
}));

vi.mock("@/lib/communications", () => ({
  retryPendingCommunications: mocks.retryPendingCommunications,
  purgeCommunicationQueue: mocks.purgeCommunicationQueue,
}));

vi.mock("@/lib/webcallbacks", () => ({
  purgeWebcallbackEvents: mocks.purgeWebcallbackEvents,
}));

function sqlParams(input: any): any[] {
  if (!input || typeof input !== "object") return [];
  const chunks = Array.isArray(input.queryChunks) ? input.queryChunks : [];
  return chunks.filter((chunk: any) => !(chunk && typeof chunk === "object" && Array.isArray(chunk.value)));
}

function makeDueRow(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "sch_1",
    owner_type: "core",
    owner_id: "core",
    site_id: null,
    name: "Test",
    action_key: "core.http_ping",
    payload: "{}",
    enabled: true,
    run_every_minutes: 60,
    max_retries: 0,
    backoff_base_seconds: 30,
    retry_count: 0,
    dead_lettered: false,
    dead_lettered_at: null,
    next_run_at: now,
    last_run_at: null,
    last_status: null,
    last_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("scheduler reliability model", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.execute.mockReset();
    mocks.getBooleanSetting.mockReset();
    mocks.getSiteUrlSetting.mockReset();
    mocks.getSiteUrlSettingForSite.mockReset();
    mocks.retryPendingCommunications.mockReset();
    mocks.purgeCommunicationQueue.mockReset();
    mocks.purgeWebcallbackEvents.mockReset();

    mocks.getBooleanSetting.mockResolvedValue(true);
    mocks.getSiteUrlSetting.mockResolvedValue({ value: "http://localhost:3000" });
    mocks.getSiteUrlSettingForSite.mockResolvedValue({ value: "http://localhost:3000" });

    mocks.execute.mockResolvedValue({ rows: [] });
  });

  it("moves schedule to dead-letter when retries are exhausted", async () => {
    const { runDueSchedules } = await import("@/lib/scheduler");
    for (let i = 0; i < 11; i += 1) mocks.execute.mockResolvedValueOnce({ rows: [] });
    mocks.execute
      .mockResolvedValueOnce({ rows: [makeDueRow({ max_retries: 0, retry_count: 0 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await runDueSchedules(10);

    expect(result.ran).toBe(1);
    expect(result.deadLettered).toBe(1);
    expect(result.errors).toBe(0);

    const updateParams = sqlParams(mocks.execute.mock.calls[12]?.[0]);
    expect(updateParams).toContain("dead_letter");
    expect(updateParams).toContain(true);

    const auditParams = sqlParams(mocks.execute.mock.calls[13]?.[0]);
    expect(auditParams).toContain("dead_letter");
  });

  it("keeps schedule active with backoff while retries remain", async () => {
    const { runDueSchedules } = await import("@/lib/scheduler");
    for (let i = 0; i < 11; i += 1) mocks.execute.mockResolvedValueOnce({ rows: [] });
    mocks.execute
      .mockResolvedValueOnce({ rows: [makeDueRow({ max_retries: 2, retry_count: 0 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await runDueSchedules(10);

    expect(result.ran).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.deadLettered).toBe(0);

    const updateParams = sqlParams(mocks.execute.mock.calls[12]?.[0]);
    expect(updateParams).toContain("error");
    expect(updateParams).toContain(false);
  });

  it("writes manual run audit with manual trigger", async () => {
    const { runScheduleEntryNow } = await import("@/lib/scheduler");
    for (let i = 0; i < 11; i += 1) mocks.execute.mockResolvedValueOnce({ rows: [] });
    mocks.execute
      .mockResolvedValueOnce({ rows: [makeDueRow({ id: "sch_manual", max_retries: 0, retry_count: 0 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await runScheduleEntryNow("sch_manual");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("dead_letter");

    const auditParams = sqlParams(mocks.execute.mock.calls[13]?.[0]);
    expect(auditParams).toContain("manual");
    expect(auditParams).toContain("dead_letter");
  });
});
