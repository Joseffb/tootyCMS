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

  it("normalizes commentProviders capability flag", () => {
    const plugin = validatePluginContract(
      {
        id: "comments-provider-plugin",
        name: "Comments Provider",
        capabilities: { commentProviders: true },
      },
      "comments-provider-plugin",
    );
    expect(plugin).not.toBeNull();
    expect(plugin?.capabilities?.commentProviders).toBe(true);
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

  it("normalizes plugin and theme tags", () => {
    const plugin = validatePluginContract(
      {
        id: "tagged-plugin",
        name: "Tagged Plugin",
        tags: [" Utility ", "Auth", "custom tag", "auth"],
      },
      "tagged-plugin",
    );
    expect(plugin?.tags).toEqual(["utility", "auth", "custom-tag"]);

    const theme = validateThemeContract(
      {
        id: "tagged-theme",
        name: "Tagged Theme",
        tags: ["Theme", " Teety "],
      },
      "tagged-theme",
    );
    expect(theme?.tags).toEqual(["theme", "teety"]);
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
            key: "featured_showcases",
            source: "content.list",
            scope: "site",
            route: "home",
            params: {
              dataDomain: "showcase",
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
    expect(theme?.queries?.[0]?.key).toBe("featured_showcases");
    expect(theme?.queries?.[0]?.route).toBe("home");
  });
});
