import { describe, expect, it } from "vitest";

import { getSetupDefaultPluginIds, getSetupDefaultThemeId } from "@/lib/setup-defaults";

describe("setup defaults helpers", () => {
  it("keeps core default plugins when no extras are provided", () => {
    expect(getSetupDefaultPluginIds("")).toEqual(["hello-teety", "tooty-comments", "tooty-ai"]);
  });

  it("adds custom plugin ids once and normalizes them", () => {
    expect(getSetupDefaultPluginIds(" tooty-carousels,TOOTY-CAROUSELS , export-import ")).toEqual([
      "hello-teety",
      "tooty-comments",
      "tooty-ai",
      "tooty-carousels",
      "export-import",
    ]);
  });

  it("returns a normalized theme id only when configured", () => {
    expect(getSetupDefaultThemeId(" Robert-Betan ")).toBe("robert-betan");
    expect(getSetupDefaultThemeId("")).toBeNull();
  });
});
