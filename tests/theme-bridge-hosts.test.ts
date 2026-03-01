import { afterEach, describe, expect, it } from "vitest";

import {
  deriveThemeBridgeAdminBaseFromReturnUrl,
  isAllowedThemeBridgeOrigin,
  isAllowedThemeBridgeReturnUrl,
} from "@/lib/theme-bridge-hosts";

describe("theme bridge host helpers", () => {
  const originalRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

  afterEach(() => {
    if (originalRootDomain === undefined) {
      delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
      return;
    }
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = originalRootDomain;
  });

  it("allows configured root domain and subdomains for bridge origins", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "robertbetan.test";

    expect(isAllowedThemeBridgeOrigin("http://robertbetan.test")).toBe(true);
    expect(isAllowedThemeBridgeOrigin("http://cp.robertbetan.test")).toBe(true);
    expect(isAllowedThemeBridgeOrigin("http://writing.robertbetan.test")).toBe(true);
    expect(isAllowedThemeBridgeOrigin("http://example.com")).toBe(false);
  });

  it("allows configured root domain return URLs", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "robertbetan.test";

    expect(isAllowedThemeBridgeReturnUrl("http://robertbetan.test/post/hello")).toBe(true);
    expect(isAllowedThemeBridgeReturnUrl("http://writing.robertbetan.test/post/hello")).toBe(true);
    expect(isAllowedThemeBridgeReturnUrl("http://example.com/post/hello")).toBe(false);
  });

  it("derives the admin base on the configured root host", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3123";

    expect(
      deriveThemeBridgeAdminBaseFromReturnUrl(
        "http://example-site.localhost:3123/post/hello",
        "http://localhost:3123",
        "cp",
      ),
    ).toBe("http://localhost:3123/app/cp");
  });
});
