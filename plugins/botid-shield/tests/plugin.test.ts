import { describe, expect, it } from "vitest";
import pluginManifest from "../plugin.json";
import { validatePluginContract } from "@/lib/extension-contracts";

describe("botid-shield plugin manifest", () => {
  it("validates as a core plugin contract", () => {
    const validated = validatePluginContract(pluginManifest, "botid-shield");
    expect(validated).not.toBeNull();
    expect(validated?.id).toBe("botid-shield");
    expect(validated?.scope).toBe("core");
    expect(validated?.capabilities?.adminExtensions).toBe(true);
  });

  it("declares required settings fields for bot protection config", () => {
    const validated = validatePluginContract(pluginManifest, "botid-shield");
    const keys = new Set((validated?.settingsFields || []).map((field) => field.key));
    expect(keys.has("mode")).toBe(true);
    expect(keys.has("protect_generate")).toBe(true);
    expect(keys.has("protect_upload_image")).toBe(true);
    expect(keys.has("allow_verified_bots")).toBe(true);
    expect(keys.has("development_bypass")).toBe(true);
  });
});

