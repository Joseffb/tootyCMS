import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";

describe("auth-facebook plugin manifest", () => {
  it("declares auth extension capability", () => {
    expect(manifest.id).toBe("auth-facebook");
    expect(manifest.capabilities.authExtensions).toBe(true);
  });
});
