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

describe("gdpr-consent plugin", () => {
  it("keeps analytics script list unchanged", async () => {
    const { kernel, filters } = createKernel();
    await register(kernel as any);

    const scriptFilter = filters.get("analytics:scripts")?.[0];
    const existing = [{ id: "existing", src: "/existing.js" }];
    const scripts = await scriptFilter!(existing);
    expect(scripts).toEqual(existing);
  });
});

