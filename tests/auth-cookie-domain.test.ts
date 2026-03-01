import { describe, expect, it } from "vitest";
import { deriveLocalCookieDomainForUrl } from "@/lib/auth";

describe("auth local cookie domain", () => {
  it("uses host-only cookies for localhost NEXTAUTH_URL in local dev", () => {
    expect(deriveLocalCookieDomainForUrl("http://localhost:3000")).toBeUndefined();
  });

  it("uses host-only cookies when NEXTAUTH_URL is the local root host", () => {
    expect(deriveLocalCookieDomainForUrl("http://localhost:3000")).toBeUndefined();
  });

  it("uses host-only cookies for any local admin-style subdomain", () => {
    expect(deriveLocalCookieDomainForUrl("http://portal.localhost:3000")).toBeUndefined();
  });
});
