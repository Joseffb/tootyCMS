import { describe, expect, it } from "vitest";
import { validatePluginContract, validateThemeContract } from "@/lib/extension-contracts";

describe("extension contracts", () => {
  it("preserves plugin minimum core version field", () => {
    const plugin = validatePluginContract(
      {
        id: "example-plugin",
        name: "Example Plugin",
        version: "0.1.2",
        minCoreVersion: "0.1.x",
      },
      "example-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.minCoreVersion).toBe("0.1.x");
  });

  it("preserves plugin developer metadata", () => {
    const plugin = validatePluginContract(
      {
        id: "example-plugin",
        name: "Example Plugin",
        developer: "Tooty CMS Core",
        website: "https://github.com/Joseffb/tootyCMS",
      },
      "example-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.developer).toBe("Tooty CMS Core");
    expect(plugin?.website).toBe("https://github.com/Joseffb/tootyCMS");
  });

  it("preserves theme minimum core version field", () => {
    const theme = validateThemeContract(
      {
        id: "example-theme",
        name: "Example Theme",
        version: "0.1.0",
        minCoreVersion: "0.1.x",
      },
      "example-theme",
    );
    expect(theme).not.toBeNull();
    expect(theme?.minCoreVersion).toBe("0.1.x");
  });

  it("validates and preserves theme manifest query declarations", () => {
    const theme = validateThemeContract(
      {
        id: "query-theme",
        name: "Query Theme",
        queries: [
          {
            key: "featured_projects",
            source: "content.list",
            scope: "site",
            route: "home",
            params: {
              dataDomain: "project",
              taxonomy: "category",
              withTerm: "featured",
              limit: 4,
            },
          },
        ],
      },
      "query-theme",
    );
    expect(theme).not.toBeNull();
    expect(theme?.queries).toHaveLength(1);
    expect(theme?.queries?.[0]?.key).toBe("featured_projects");
    expect(theme?.queries?.[0]?.route).toBe("home");
  });
});
