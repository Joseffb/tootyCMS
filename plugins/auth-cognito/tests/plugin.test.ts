import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";

describe("auth-cognito plugin manifest", () => {
  it("declares auth extension capability", () => {
    expect(manifest.id).toBe("auth-cognito");
    expect(manifest.capabilities.authExtensions).toBe(true);
    expect(manifest.authProviderId).toBe("cognito");
  });
});
