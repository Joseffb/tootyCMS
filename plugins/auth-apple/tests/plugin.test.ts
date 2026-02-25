import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";

describe("auth-apple plugin manifest", () => {
  it("declares auth extension capability", () => {
    expect(manifest.id).toBe("auth-apple");
    expect(manifest.capabilities.authExtensions).toBe(true);
  });
});
