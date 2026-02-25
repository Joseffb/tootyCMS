import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";

describe("auth-github plugin manifest", () => {
  it("declares auth extension capability", () => {
    expect(manifest.id).toBe("auth-github");
    expect(manifest.capabilities.authExtensions).toBe(true);
  });
});
