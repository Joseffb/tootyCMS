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
});
