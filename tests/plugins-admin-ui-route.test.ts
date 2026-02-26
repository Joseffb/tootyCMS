import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createKernelForRequest: vi.fn(),
  listPluginsWithState: vi.fn(),
  listPluginsWithSiteState: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/plugins", () => ({
  listPluginsWithState: mocks.listPluginsWithState,
  listPluginsWithSiteState: mocks.listPluginsWithSiteState,
}));

describe("GET /api/plugins/admin-ui", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.listPluginsWithState.mockReset();
    mocks.listPluginsWithSiteState.mockReset();
  });

  it("passes shared page/use_type context into admin filters", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.listPluginsWithSiteState.mockResolvedValue([
      { id: "analytics-google", enabled: true, siteEnabled: true },
    ]);
    const contexts: any[] = [];
    const kernel = {
      applyFilters: vi.fn(async (name: string, value: any, context: any) => {
        contexts.push({ name, context });
        if (name === "admin:context-use-types") return ["default", "utility", "theme"];
        if (name === "admin:context-use-type") return "utility";
        if (name === "admin:brand-use-type") return value;
        if (name === "admin:environment-badge") return { show: true, label: "Dev", environment: "development" };
        if (name === "admin:floating-widgets") {
          return [{ id: "w1", title: "Widget", content: "ok", position: "bottom-right" }];
        }
        return value;
      }),
    };
    mocks.createKernelForRequest.mockResolvedValue(kernel);

    const { GET } = await import("@/app/api/plugins/admin-ui/route");
    const response = await GET(
      new Request(
        "http://localhost/api/plugins/admin-ui?siteId=site_1&path=%2Fplugins%2Fexport-import",
      ),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.use_type).toBe("utility");
    expect(json.use_types).toEqual(["default", "utility", "theme"]);
    expect(json.page?.scope).toBe("plugin");
    expect(json.page?.pluginId).toBe("export-import");
    expect(json.hasAnalyticsProviders).toBe(true);

    const widgetContext = contexts.find((entry) => entry.name === "admin:floating-widgets")?.context;
    expect(widgetContext?.use_type).toBe("utility");
    expect(widgetContext?.page?.pluginId).toBe("export-import");
  });
});
