import { describe, expect, it } from "vitest";
import { deriveLocalCookieDomainForUrl } from "@/lib/auth";

describe("auth local cookie domain", () => {
  it("uses host-only cookies for localhost NEXTAUTH_URL in local dev", () => {
    expect(deriveLocalCookieDomainForUrl("http://localhost:3000")).toBeUndefined();
  });

  it("uses host-only cookies when NEXTAUTH_URL host already has local subdomain", () => {
    expect(deriveLocalCookieDomainForUrl("http://app.localhost:3000")).toBeUndefined();
  });
});
