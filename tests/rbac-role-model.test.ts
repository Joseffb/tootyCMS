import { describe, expect, it } from "vitest";
import { SITE_CAPABILITIES, defaultCapabilityMatrix, normalizeRole } from "@/lib/rbac";
import { MANAGE_PLUGIN_CONTENT_META_CAPABILITY, pluginContentMetaCapability } from "@/lib/plugin-permissions";

describe("rbac role model", () => {
  it("normalizes role identifiers to lowercase trimmed form", () => {
    expect(normalizeRole("  Seo-Manager  ")).toBe("seo-manager");
    expect(normalizeRole("Administrator")).toBe("administrator");
  });

  it("includes all capabilities for each default system role", () => {
    const matrix = defaultCapabilityMatrix();
    for (const role of ["network admin", "administrator", "editor", "author"]) {
      expect(Object.keys(matrix[role] || {}).sort()).toEqual([...SITE_CAPABILITIES].sort());
    }
  });

  it("keeps network admin fully enabled by default", () => {
    const matrix = defaultCapabilityMatrix();
    for (const capability of SITE_CAPABILITIES) {
      expect(matrix["network admin"][capability]).toBe(true);
    }
  });

  it("keeps generic plugin content meta enabled for administrators but not editors/authors", () => {
    const matrix = defaultCapabilityMatrix();
    expect(matrix["administrator"][MANAGE_PLUGIN_CONTENT_META_CAPABILITY]).toBe(true);
    expect(matrix["editor"][MANAGE_PLUGIN_CONTENT_META_CAPABILITY]).toBe(false);
    expect(matrix["author"][MANAGE_PLUGIN_CONTENT_META_CAPABILITY]).toBe(false);
  });

  it("does not preseed plugin-specific content meta capabilities", () => {
    const matrix = defaultCapabilityMatrix();
    const pluginCapability = pluginContentMetaCapability("tooty-comments");
    expect(matrix["network admin"][pluginCapability]).toBeUndefined();
  });
});
