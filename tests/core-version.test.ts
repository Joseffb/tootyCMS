import { describe, expect, it } from "vitest";
import { CORE_VERSION, CORE_VERSION_SERIES, isCoreVersionCompatible } from "@/lib/core-version";

describe("core version compatibility", () => {
  it("keeps declared version line stable", () => {
    expect(CORE_VERSION).toBe("0.4.0");
    expect(CORE_VERSION_SERIES).toBe("0.4.x");
  });

  it("accepts equal or lower minimum versions", () => {
    expect(isCoreVersionCompatible()).toBe(true);
    expect(isCoreVersionCompatible("0.4.0")).toBe(true);
    expect(isCoreVersionCompatible("0.4.x")).toBe(true);
    expect(isCoreVersionCompatible("0.3.9")).toBe(true);
  });

  it("rejects higher or invalid minimum versions", () => {
    expect(isCoreVersionCompatible("0.5.0")).toBe(false);
    expect(isCoreVersionCompatible("banana")).toBe(false);
  });
});
