import { describe, expect, it, vi } from "vitest";
import { createPluginExtensionApi, createThemeExtensionApi } from "@/lib/extension-api";

describe("extension guardrails", () => {
  it("throws when plugin registers content type without capability", () => {
    const api = createPluginExtensionApi("guarded-plugin", {
      capabilities: { contentTypes: false },
      coreRegistry: {
        registerContentType: vi.fn(),
        registerServerHandler: vi.fn(),
      },
    });

    expect(() =>
      api.registerContentType({
        key: "vehicles",
        label: "Vehicles",
      }),
    ).toThrow(/plugin-guard/i);
  });

  it("throws when plugin registers server handler without capability", () => {
    const api = createPluginExtensionApi("guarded-plugin", {
      capabilities: { serverHandlers: false },
      coreRegistry: {
        registerContentType: vi.fn(),
        registerServerHandler: vi.fn(),
      },
    });

    expect(() =>
      api.registerServerHandler({
        id: "vehicle-sync",
        method: "POST",
        path: "/api/plugins/vehicle-sync",
      }),
    ).toThrow(/plugin-guard/i);
  });

  it("forwards declarations through Core registry when capability is enabled", () => {
    const registerContentType = vi.fn();
    const registerServerHandler = vi.fn();
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { contentTypes: true, serverHandlers: true },
      coreRegistry: {
        registerContentType,
        registerServerHandler,
      },
    });

    api.registerContentType({ key: "used-cars", label: "Used Cars" });
    api.registerServerHandler({
      id: "inventory-refresh",
      method: "POST",
      path: "/api/plugins/inventory/refresh",
    });

    expect(registerContentType).toHaveBeenCalledWith({ key: "used-cars", label: "Used Cars" });
    expect(registerServerHandler).toHaveBeenCalledWith({
      id: "inventory-refresh",
      method: "POST",
      path: "/api/plugins/inventory/refresh",
    });
  });

  it("throws when capability is enabled but Core registry is missing", () => {
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { contentTypes: true },
    });

    expect(() => api.registerContentType({ key: "docs" })).toThrow(/unavailable outside Core runtime/i);
  });

  it("blocks theme side-effect settings writes", async () => {
    const api = createThemeExtensionApi();

    await expect(api.setSetting("foo", "bar")).rejects.toThrow(/theme-guard/i);
    await expect(api.setPluginSetting("foo", "bar")).rejects.toThrow(/theme-guard/i);
  });
});

