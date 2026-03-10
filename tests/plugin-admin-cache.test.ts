import { describe, expect, it } from "vitest";

import { getPluginWorkspaceRevalidationPaths } from "@/lib/plugin-admin-cache";

describe("getPluginWorkspaceRevalidationPaths", () => {
  it("revalidates both plugin workspace route variants and the site settings page", () => {
    expect(getPluginWorkspaceRevalidationPaths("tooty-carousels", "site-123")).toEqual([
      "/plugins/tooty-carousels",
      "/app/plugins/tooty-carousels",
      "/app/site/site-123/settings/plugins",
    ]);
  });

  it("does not emit query-string-based paths", () => {
    const paths = getPluginWorkspaceRevalidationPaths("tooty-carousels", "site-123");
    expect(paths.every((path) => !path.includes("?"))).toBe(true);
  });

  it("deduplicates and tolerates missing site ids", () => {
    expect(getPluginWorkspaceRevalidationPaths("tooty-carousels")).toEqual([
      "/plugins/tooty-carousels",
      "/app/plugins/tooty-carousels",
    ]);
  });
});
