import { describe, expect, it } from "vitest";
import {
  buildArchivePath,
  buildDetailPath,
  domainPluralSegment,
  type SitePermalinkSettings,
} from "@/lib/permalink";

const defaultSettings: SitePermalinkSettings = {
  permalinkMode: "default",
  singlePattern: "/%domain%/%slug%",
  listPattern: "/%domain_plural%",
  noDomainPrefix: "",
  noDomainDataDomain: "post",
};

describe("permalink contract", () => {
  it("pluralizes archive segments in default mode", () => {
    expect(domainPluralSegment("post")).toBe("posts");
    expect(domainPluralSegment("showcase")).toBe("showcases");
    expect(domainPluralSegment("company")).toBe("companies");
    expect(buildArchivePath("post", defaultSettings)).toBe("/posts");
    expect(buildArchivePath("showcase", defaultSettings)).toBe("/showcases");
  });

  it("keeps detail routes singular in default mode", () => {
    expect(buildDetailPath("post", "hello-world", defaultSettings)).toBe("/post/hello-world");
    expect(buildDetailPath("showcase", "fernain-jobs", defaultSettings)).toBe("/showcase/fernain-jobs");
  });

  it("supports no-domain mapping in custom mode", () => {
    const customSettings: SitePermalinkSettings = {
      ...defaultSettings,
      permalinkMode: "custom",
      noDomainPrefix: "content",
      noDomainDataDomain: "post",
    };

    expect(buildArchivePath("post", customSettings)).toBe("/content");
    expect(buildDetailPath("post", "hello-world", customSettings)).toBe("/content/hello-world");
    expect(buildArchivePath("showcase", customSettings)).toBe("/showcases");
  });
});
