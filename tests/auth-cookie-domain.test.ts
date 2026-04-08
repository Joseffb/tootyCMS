import { describe, expect, it } from "vitest";
import { deriveLocalCookieDomainForUrl, deriveVercelCookieDomain } from "@/lib/auth";

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

describe("auth vercel cookie domain", () => {
  it("uses host-only cookies for preview deployments", () => {
    expect(
      deriveVercelCookieDomain({
        vercelEnv: "preview",
        rootDomain: "robertbetan.com",
        nextAuthUrl: "https://robertbetan.com",
      }),
    ).toBeUndefined();
  });

  it("uses the configured root domain on production when NEXTAUTH_URL matches it", () => {
    expect(
      deriveVercelCookieDomain({
        vercelEnv: "production",
        rootDomain: "robertbetan.com",
        nextAuthUrl: "https://robertbetan.com",
      }),
    ).toBe(".robertbetan.com");
  });

  it("fails closed to a host-only cookie on production when NEXTAUTH_URL points elsewhere", () => {
    expect(
      deriveVercelCookieDomain({
        vercelEnv: "production",
        rootDomain: "robertbetan.com",
        nextAuthUrl: "https://robertbetan-dg1ul9tj9-joseffbs-projects.vercel.app",
      }),
    ).toBeUndefined();
  });
});
