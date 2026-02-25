import { describe, expect, it } from "vitest";
import { SITE_CAPABILITIES, defaultCapabilityMatrix, normalizeRole } from "@/lib/rbac";

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
});
