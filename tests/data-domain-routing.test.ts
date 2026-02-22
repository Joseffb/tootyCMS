import { describe, expect, it } from "vitest";
import {
  isDomainArchiveSegment,
  normalizeDomainKeyFromSegment,
  normalizeDomainSegment,
} from "@/lib/data-domain-routing";

describe("data-domain routing contract", () => {
  it("normalizes route segments", () => {
    expect(normalizeDomainSegment("  Projects  ")).toBe("projects");
    expect(normalizeDomainKeyFromSegment("Projects")).toBe("project");
    expect(normalizeDomainKeyFromSegment("Companies")).toBe("company");
  });

  it("accepts plural listing segments for archives", () => {
    expect(isDomainArchiveSegment("projects", "project", "Project")).toBe(true);
    expect(isDomainArchiveSegment("companies", "company", "Company")).toBe(true);
  });

  it("rejects singular segment for listing route", () => {
    expect(isDomainArchiveSegment("project", "project", "Project")).toBe(false);
  });
});
