import { describe, expect, it } from "vitest";
import { getCoreDataDomainDefaultDescription, resolveDataDomainDescription } from "@/lib/data-domain-descriptions";

describe("data domain description resolution", () => {
  it("prefers site-scoped override when provided", () => {
    expect(
      resolveDataDomainDescription({
        domainKey: "post",
        siteDescription: "Site-specific description",
        globalDescription: "Global description",
      }),
    ).toBe("Site-specific description");
  });

  it("falls back core domains to seeded defaults instead of shared global values", () => {
    expect(
      resolveDataDomainDescription({
        domainKey: "post",
        siteDescription: "",
        globalDescription: "Leaked global description",
      }),
    ).toBe(getCoreDataDomainDefaultDescription("post"));
  });

  it("falls back to global description for non-core domains", () => {
    expect(
      resolveDataDomainDescription({
        domainKey: "carousel-slide",
        siteDescription: "",
        globalDescription: "Carousel index",
      }),
    ).toBe("Carousel index");
  });
});
