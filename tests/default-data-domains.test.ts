import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  inserted: [] as Array<Record<string, unknown>>,
  findCalls: 0,
};

vi.mock("@/lib/site-data-domain-registry", () => ({
  ensureSiteDataDomainTable: vi.fn(async () => undefined),
  findSiteDataDomainByKey: vi.fn(async () => {
    state.findCalls += 1;
    return null;
  }),
  upsertSiteDataDomain: vi.fn(async (siteId: string, payload: Record<string, unknown>) => {
    state.inserted.push({ siteId, ...payload });
    return {
      id: state.inserted.length,
      key: String(payload.key || ""),
    };
  }),
}));

vi.mock("@/lib/db", () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(async () => [{ id: "site-1" }]),
    })),
  };
  return { default: db };
});

describe("ensureDefaultCoreDataDomains", () => {
  beforeEach(() => {
    state.inserted.length = 0;
    state.findCalls = 0;
    process.env.CMS_DB_PREFIX = "tooty_";
  });

  it("creates post and page domains with unique table identifiers", async () => {
    const { ensureDefaultCoreDataDomains } = await import("@/lib/default-data-domains");

    const out = await ensureDefaultCoreDataDomains();

    expect(out.get("post")).toBe(1);
    expect(out.get("page")).toBe(2);

    expect(state.inserted).toHaveLength(2);
    expect(state.inserted[0]).toMatchObject({
      siteId: "site-1",
      key: "post",
      contentTable: "tooty_site_{id}_domain_post",
      metaTable: "tooty_site_{id}_domain_post_meta",
    });
    expect(state.inserted[1]).toMatchObject({
      siteId: "site-1",
      key: "page",
      contentTable: "tooty_site_{id}_domain_page",
      metaTable: "tooty_site_{id}_domain_page_meta",
    });
  });
});
