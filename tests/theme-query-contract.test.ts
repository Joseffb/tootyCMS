import { describe, expect, it } from "vitest";
import { resolveThemeQueryRequests } from "@/lib/theme-query-contract";

describe("theme query contract", () => {
  it("resolves route-matched and route-agnostic manifest queries", () => {
    const requests = resolveThemeQueryRequests(
      {
        kind: "theme",
        id: "fernain-portfolio",
        name: "Fernain Portfolio",
        queries: [
          {
            key: "featured_showcases",
            source: "content.list",
            route: "home",
            scope: "site",
            params: { dataDomain: "showcase", taxonomy: "category", withTerm: "featured", limit: 4 },
          },
          {
            key: "latest_posts",
            source: "content.list",
            scope: "site",
            params: { dataDomain: "post", limit: 5 },
          },
          {
            key: "detail_related",
            source: "content.list",
            route: "domain_detail",
            scope: "site",
            params: { dataDomain: "showcase", limit: 3 },
          },
        ],
      },
      "home",
    );

    expect(requests.map((request) => request.key)).toEqual(["featured_showcases", "latest_posts"]);
  });

  it("returns empty requests for themes without query declarations", () => {
    const requests = resolveThemeQueryRequests(
      { kind: "theme", id: "tooty-light", name: "Tooty Light" },
      "home",
    );
    expect(requests).toEqual([]);
  });
});
