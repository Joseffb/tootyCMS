import { describe, expect, it } from "vitest";
import { register } from "../index.mjs";

function createKernel() {
  const filters = new Map<string, Array<(current: any, context?: any) => any>>();
  return {
    filters,
    kernel: {
      addFilter(name: string, callback: (current: any, context?: any) => any) {
        const current = filters.get(name) || [];
        current.push(callback);
        filters.set(name, current);
      },
    },
  };
}

describe("analytics-vercel plugin", () => {
  it("always injects vercel analytics scripts when plugin is active", async () => {
    const { kernel, filters } = createKernel();
    await register(kernel as any, {});

    const scriptFilter = filters.get("domain:scripts")?.[0];
    expect(scriptFilter).toBeTruthy();

    const existing = [{ id: "existing", src: "/existing.js" }];
    const scripts = await scriptFilter!(existing);

    expect(scripts).toHaveLength(3);
    expect(scripts[1].id).toBe("analytics-vercel-bootstrap");
    expect(scripts[2]).toMatchObject({
      id: "analytics-vercel-sdk",
      src: "/_vercel/insights/script.js",
      strategy: "afterInteractive",
    });
  });
});

