import { describe, expect, it, vi } from "vitest";
import { applyThemeContentTransform } from "@/lib/theme-content-transform";

describe("theme content transform", () => {
  it("passes transformed html through the generic content:transform hook", async () => {
    const applyFilters = vi.fn().mockResolvedValue('<a data-story-artifact-link="1">Play</a>');

    const result = await applyThemeContentTransform(
      { applyFilters } as any,
      "<a>Play</a>",
      {
        siteId: "site-1",
        routeKind: "domain_detail",
        entry: {
          id: "chapter-1",
          dataDomain: "story-chapter",
          meta: [{ key: "story_id", value: "story-1" }],
        },
      },
    );

    expect(applyFilters).toHaveBeenCalledWith("content:transform", "<a>Play</a>", {
      siteId: "site-1",
      routeKind: "domain_detail",
      entry: {
        id: "chapter-1",
        dataDomain: "story-chapter",
        meta: [{ key: "story_id", value: "story-1" }],
      },
    });
    expect(result).toBe('<a data-story-artifact-link="1">Play</a>');
  });
});
