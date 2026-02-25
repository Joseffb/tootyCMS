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

describe("hello-teety plugin", () => {
  const getPluginSetting = vi.fn(async () => "");
  const getSetting = vi.fn(async () => "");

  beforeEach(() => {
    getPluginSetting.mockReset();
    getSetting.mockReset();
  });

  it("adds floating widget by default", async () => {
    const { kernel, filters } = createKernel();
    await register(kernel as any, { getPluginSetting, getSetting });

    const widgetFilter = filters.get("admin:floating-widgets")?.[0];
    const widgets = await widgetFilter!([], { siteId: "site_123" });
    expect(widgets).toHaveLength(1);
    expect(widgets[0].id).toBe("hello-teety-quote");
    expect(widgets[0].title).toBe("Hello Teety");
    expect(typeof widgets[0].content).toBe("string");
    expect(widgets[0].content.length).toBeGreaterThan(0);
  });

  it("adds floating widget on global admin pages without site context", async () => {
    const { kernel, filters } = createKernel();
    await register(kernel as any, { getPluginSetting, getSetting });

    const widgetFilter = filters.get("admin:floating-widgets")?.[0];
    const widgets = await widgetFilter!([], {});
    expect(widgets).toHaveLength(1);
    expect(widgets[0].id).toBe("hello-teety-quote");
  });

  it("skips floating widget when showWidget is disabled", async () => {
    const { kernel, filters } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => (key === "showWidget" ? "false" : ""));

    await register(kernel as any, { getPluginSetting, getSetting });
    const widgetFilter = filters.get("admin:floating-widgets")?.[0];
    const widgets = await widgetFilter!([], { siteId: "site_123" });
    expect(widgets).toEqual([]);
  });

  it("appends debug trace when showInDebug is enabled", async () => {
    const { kernel, actions } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => (key === "showInDebug" ? "true" : ""));
    await register(kernel as any, { getPluginSetting, getSetting });

    const requestBegin = actions.get("request:begin")?.[0];
    const context: Record<string, unknown> = { debug: true };
    await requestBegin!(context);
    expect(Array.isArray(context.trace)).toBe(true);
    expect(String((context.trace as string[])[0])).toContain("hello-teety:");
  });

  it("uses teety-dark specific quote pool when site theme is teety-dark", async () => {
    const { kernel, filters } = createKernel();
    getSetting.mockImplementation(async (key: string) => (key === "site_site_123_theme" ? "teety-dark" : ""));
    await register(kernel as any, { getPluginSetting, getSetting });

    const widgetFilter = filters.get("admin:floating-widgets")?.[0];
    const widgets = await widgetFilter!([], { siteId: "site_123" });
    expect(widgets).toHaveLength(1);
    const quote = String(widgets[0].content);
    expect(quote.length).toBeGreaterThan(0);
  });
});
