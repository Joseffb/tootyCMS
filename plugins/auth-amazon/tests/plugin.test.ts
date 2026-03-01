import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";

describe("auth-amazon plugin manifest", () => {
  it("declares auth extension capability", () => {
    expect(manifest.id).toBe("auth-amazon");
    expect(manifest.capabilities.authExtensions).toBe(true);
    expect(manifest.authProviderId).toBe("amazon");
  });
});
