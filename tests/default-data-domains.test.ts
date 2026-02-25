import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  inserted: [] as Array<Record<string, unknown>>,
  findCalls: 0,
};

vi.mock("@/lib/db", () => {
  const db = {
    query: {
      dataDomains: {
        findFirst: vi.fn(async () => {
          state.findCalls += 1;
          return null;
        }),
      },
    },
    insert: vi.fn(() => ({
      values: (payload: Record<string, unknown>) => {
        state.inserted.push(payload);
        return {
          onConflictDoNothing: () => ({
            returning: async () => [{ id: state.inserted.length, key: payload.key }],
          }),
        };
      },
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
      key: "post",
      contentTable: "tooty_domain_post",
      metaTable: "tooty_domain_post_meta",
    });
    expect(state.inserted[1]).toMatchObject({
      key: "page",
      contentTable: "tooty_domain_page",
      metaTable: "tooty_domain_page_meta",
    });
  });
});
