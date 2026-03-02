import { describe, expect, it, vi } from "vitest";
import { createPluginExtensionApi, createThemeExtensionApi } from "@/lib/extension-api";

describe("extension guardrails", () => {
  it("throws when plugin registers content type without capability", () => {
    const api = createPluginExtensionApi("guarded-plugin", {
      capabilities: { contentTypes: false },
      coreRegistry: {
        registerContentType: vi.fn(),
      },
    });

    expect(() =>
      api.registerContentType({
        key: "vehicles",
        label: "Vehicles",
      }),
    ).toThrow(/plugin-guard/i);
  });

  it("forwards declarations through Core registry when capability is enabled", () => {
    const registerContentType = vi.fn();
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { contentTypes: true },
      coreRegistry: {
        registerContentType,
      },
    });

    api.registerContentType({ key: "used-cars", label: "Used Cars" });

    expect(registerContentType).toHaveBeenCalledWith({ key: "used-cars", label: "Used Cars" });
  });

  it("throws when capability is enabled but Core registry is missing", () => {
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { contentTypes: true },
    });

    expect(() => api.registerContentType({ key: "docs" })).toThrow(/unavailable outside Core runtime/i);
  });

  it("throws when plugin registers auth provider without capability", () => {
    const api = createPluginExtensionApi("guarded-plugin", {
      capabilities: { authExtensions: false },
      coreRegistry: {
        registerContentType: vi.fn(),
        registerAuthProvider: vi.fn(),
      },
    });

    expect(() =>
      api.registerAuthProvider({
        id: "custom-auth",
        type: "oauth",
        authorize: async () => ({ ok: true, config: {} }),
        callback: async () => ({ allow: true }),
        mapProfile: async () => ({}),
        createAuthProvider: async () => ({ id: "custom-auth" }),
      }),
    ).toThrow(/plugin-guard/i);
  });

  it("blocks theme side-effect settings writes", async () => {
    const api = createThemeExtensionApi();

    await expect(api.setSetting("foo", "bar")).rejects.toThrow(/theme-guard/i);
    await expect(api.setPluginSetting("foo", "bar")).rejects.toThrow(/theme-guard/i);
  });

  it("throws when plugin registers comment provider without capability", () => {
    const api = createPluginExtensionApi("guarded-plugin", {
      capabilities: { commentProviders: false },
      coreRegistry: {
        registerCommentProvider: vi.fn(),
      } as any,
    });

    expect(() =>
      api.registerCommentProvider({
        id: "comments-basic",
        create: vi.fn() as any,
        update: vi.fn() as any,
        delete: vi.fn() as any,
        list: vi.fn() as any,
        moderate: vi.fn() as any,
      }),
    ).toThrow(/plugin-guard/i);
  });

  it("forwards comment provider when capability is enabled, including external providers that do not use the native table adapter", () => {
    const registerCommentProvider = vi.fn();
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { commentProviders: true },
      coreRegistry: {
        registerCommentProvider,
      } as any,
    });

    const registration = {
      id: "comments-advanced",
      create: vi.fn() as any,
      update: vi.fn() as any,
      delete: vi.fn() as any,
      list: vi.fn() as any,
      moderate: vi.fn() as any,
    };
    api.registerCommentProvider(registration);

    expect(registerCommentProvider).toHaveBeenCalledWith(registration);
  });

  it("requires a bound site when creating a table-backed comment provider adapter", () => {
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { commentProviders: true },
      coreRegistry: {
        registerCommentProvider: vi.fn(),
      } as any,
    });

    expect(() => api.core.comments.createTableBackedProvider()).toThrow(/requires a bound site plugin context/i);
  });

  it("returns a table-backed comment provider adapter when site context is bound", () => {
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { commentProviders: true },
      coreRegistry: {
        registerCommentProvider: vi.fn(),
      } as any,
      siteId: "site-1",
    });

    const provider = api.core.comments.createTableBackedProvider({
      id: "comments-basic",
    });

    expect(provider.id).toBe("comments-basic");
    expect(typeof provider.create).toBe("function");
    expect(typeof provider.list).toBe("function");
  });
});
