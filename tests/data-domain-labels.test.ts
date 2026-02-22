import { describe, expect, it } from "vitest";
import { pluralizeLabel, singularizeLabel } from "@/lib/data-domain-labels";

describe("data-domain label inflection", () => {
  it("keeps canonical singular labels for domain identity", () => {
    expect(singularizeLabel("Projects")).toBe("Project");
    expect(singularizeLabel("Companies")).toBe("Company");
    expect(singularizeLabel("Classes")).toBe("Class");
  });

  it("pluralizes labels for listing/menu UX", () => {
    expect(pluralizeLabel("Project")).toBe("Projects");
    expect(pluralizeLabel("Company")).toBe("Companies");
    expect(pluralizeLabel("Class")).toBe("Classes");
  });
});
