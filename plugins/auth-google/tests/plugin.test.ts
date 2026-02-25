import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";

describe("auth-google plugin manifest", () => {
  it("declares auth extension capability", () => {
    expect(manifest.id).toBe("auth-google");
    expect(manifest.capabilities.authExtensions).toBe(true);
  });
});
