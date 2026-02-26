import { describe, expect, it } from "vitest";
import {
  isDomainArchiveSegment,
  normalizeDomainKeyFromSegment,
  normalizeDomainSegment,
} from "@/lib/data-domain-routing";

describe("data-domain routing contract", () => {
  it("normalizes route segments", () => {
    expect(normalizeDomainSegment("  Showcases  ")).toBe("showcases");
    expect(normalizeDomainKeyFromSegment("Showcases")).toBe("showcase");
    expect(normalizeDomainKeyFromSegment("Companies")).toBe("company");
  });

  it("accepts plural listing segments for archives", () => {
    expect(isDomainArchiveSegment("showcases", "showcase", "Showcase")).toBe(true);
    expect(isDomainArchiveSegment("companies", "company", "Company")).toBe(true);
  });

  it("rejects singular segment for listing route", () => {
    expect(isDomainArchiveSegment("showcase", "showcase", "Showcase")).toBe(false);
  });
});
