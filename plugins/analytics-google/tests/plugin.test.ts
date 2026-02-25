import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../index.mjs";

type KernelLike = {
  addFilter: (name: string, callback: (current: any, context?: any) => any) => void;
};

function createKernel() {
  const filters = new Map<string, Array<(current: any, context?: any) => any>>();
  const kernel: KernelLike = {
    addFilter(name, callback) {
      const current = filters.get(name) || [];
      current.push(callback);
      filters.set(name, current);
    },
  };
  return { kernel, filters };
}

describe("analytics-google plugin", () => {
  const getPluginSetting = vi.fn(async () => "");

  beforeEach(() => {
    getPluginSetting.mockReset();
  });

  it("adds GA script + init when a tag id is configured", async () => {
    const { kernel, filters } = createKernel();
    getPluginSetting.mockImplementation(async (key: string) => {
      if (key === "tagId") return "G-TEST123";
      return "";
    });

    await register(kernel as any, { getPluginSetting });
    const scriptFilter = filters.get("domain:scripts")?.[0];
    expect(scriptFilter).toBeTruthy();

    const scripts = await scriptFilter!([]);
    expect(scripts).toHaveLength(2);
    expect(scripts[0].src).toContain("googletagmanager.com/gtag/js?id=G-TEST123");
    expect(scripts[1].inline).toContain("gtag('config', 'G-TEST123')");
  });

  it("returns current scripts when no tag id is configured", async () => {
    const { kernel, filters } = createKernel();
    await register(kernel as any, { getPluginSetting });
    const scriptFilter = filters.get("domain:scripts")?.[0];

    const existing = [{ id: "existing", src: "/existing.js" }];
    const scripts = await scriptFilter!(existing);
    expect(scripts).toEqual(existing);
  });
});

