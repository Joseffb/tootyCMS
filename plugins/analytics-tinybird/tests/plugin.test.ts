import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../index.mjs";

function createKernel() {
  const filters = new Map<string, Array<(current: any, context?: any) => any>>();
  const actions = new Map<string, Array<(payload?: any) => any>>();
  return {
    filters,
    actions,
    kernel: {
      addFilter(name: string, callback: (current: any, context?: any) => any) {
        const current = filters.get(name) || [];
        current.push(callback);
        filters.set(name, current);
      },
      addAction(name: string, callback: (payload?: any) => any) {
        const current = actions.get(name) || [];
        current.push(callback);
        actions.set(name, current);
      },
    },
  };
}

describe("analytics-tinybird plugin", () => {
  const getPluginSetting = vi.fn(async () => "");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

  beforeEach(() => {
    getPluginSetting.mockReset();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("handles analytics query for matching provider and forwards to tinybird", async () => {
    const { kernel, filters } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => {
      if (key === "providerKey") return "tinybird";
      if (key === "dashboardToken") return "dash-token";
      if (key === "host") return "https://tinybird.example";
      return "";
    });
    await register(kernel as any, { getPluginSetting });

    const queryFilter = filters.get("analytics:query")?.[0];
    const response = await queryFilter!(null, { name: "top_pages", params: { provider: "tinybird" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://tinybird.example/v0/pipes/top_pages.json");
    expect(String(url)).toContain("token=dash-token");
    expect(response.status).toBe(200);
  });

  it("does not forward admin analytics events", async () => {
    const { kernel, actions } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => {
      if (key === "ingestToken") return "ingest-token";
      return "";
    });
    await register(kernel as any, { getPluginSetting });

    const eventAction = actions.get("analytics:event")?.[0];
    await eventAction!({ name: "page_view", actorType: "admin" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

