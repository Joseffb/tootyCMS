import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../index.mjs";

function createKernel() {
  const filters = new Map<string, Array<(current: any, context?: any) => any>>();
  const actions = new Map<string, Array<(payload?: any) => any>>();
  const routes: any[] = [];
  return {
    filters,
    actions,
    routes,
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
      registerRoute(registration: any) {
        routes.push(registration);
      },
    },
  };
}

describe("dev-tools plugin", () => {
  const getPluginSetting = vi.fn(async () => "");

  beforeEach(() => {
    getPluginSetting.mockReset();
  });

  it("returns environment badge config from plugin settings", async () => {
    const { kernel, filters } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => {
      if (key === "showEnvironmentBanner") return "true";
      if (key === "developmentLabel") return "Dev";
      if (key === "productionLabel") return "Prod";
      return "";
    });

    await register(kernel as any, { getPluginSetting });

    const badgeFilter = filters.get("admin:environment-badge")?.[0];
    const result = await badgeFilter!(null, { environment: "development" });
    expect(result).toEqual({
      show: true,
      label: "Dev",
      environment: "development",
    });
  });

  it("always shows environment badge when plugin is active", async () => {
    const { kernel, filters } = createKernel();
    getPluginSetting.mockImplementation(async () => "");

    await register(kernel as any, { getPluginSetting });
    const badgeFilter = filters.get("admin:environment-badge")?.[0];
    const result = await badgeFilter!(null, { environment: "production" });
    expect(result.show).toBe(true);
    expect(result.environment).toBe("production");
  });

  it("registers a governed plugin route for environment badge preview", async () => {
    const { kernel, routes } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => {
      if (key === "developmentLabel") return "Dev";
      if (key === "productionLabel") return "Prod";
      return "";
    });

    await register(kernel as any, { getPluginSetting });

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      namespace: "dev-tools",
      method: "GET",
      path: "/environment-badge-preview",
      auth: "admin",
      capability: "network.plugins.manage",
    });

    await expect(routes[0].handler({ query: { environment: "development" } })).resolves.toEqual({
      ok: true,
      badge: {
        show: true,
        label: "Dev",
        environment: "development",
      },
    });
  });
});
