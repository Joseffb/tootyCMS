import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createKernelForRequest: vi.fn(),
  runAiRequest: vi.fn(),
  registerAiProvider: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/ai-spine", () => ({
  runAiRequest: mocks.runAiRequest,
}));

import { createKernel } from "@/lib/kernel";
import { createPluginExtensionApi } from "@/lib/extension-api";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.createKernelForRequest.mockReset();
  mocks.runAiRequest.mockReset();
  mocks.registerAiProvider.mockReset();
});

describe("AI extension api", () => {
  it("rejects duplicate AI provider ids across core and plugin registrations", () => {
    const kernel = createKernel();
    const registration = {
      id: "openai",
      actions: ["generate"],
      run: vi.fn(),
    } as const;

    kernel.registerCoreAiProvider(registration);

    expect(() => kernel.registerPluginAiProvider("plugin-a", registration)).toThrow(/duplicate ai provider id/i);
  });

  it("guards plugin AI provider registration behind aiProviders capability", () => {
    const api = createPluginExtensionApi("guarded-plugin", {
      capabilities: { aiProviders: false },
      coreRegistry: {
        registerAiProvider: mocks.registerAiProvider,
      } as any,
    });

    expect(() =>
      api.registerAiProvider({
        id: "adapter",
        actions: ["generate"],
        run: vi.fn(),
      }),
    ).toThrow(/plugin-guard/i);
  });

  it("forwards plugin AI provider registrations when capability is enabled", () => {
    const api = createPluginExtensionApi("declared-plugin", {
      capabilities: { aiProviders: true },
      coreRegistry: {
        registerAiProvider: mocks.registerAiProvider,
      } as any,
    });
    const registration = {
      id: "adapter",
      actions: ["generate"],
      run: vi.fn(),
    };

    api.registerAiProvider(registration);

    expect(mocks.registerAiProvider).toHaveBeenCalledWith(registration);
  });

  it("routes core.ai.run through the governed spine with a site-scoped kernel context", async () => {
    const providers = [{ id: "openai" }];
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.createKernelForRequest.mockResolvedValue({
      getAllAiProviders: () => providers,
    });
    mocks.runAiRequest.mockResolvedValue({
      ok: true,
      decision: "allow",
      output: { kind: "text", text: "Generated" },
      providerId: "openai",
      model: "gpt-4o-mini",
      traceId: "trace-extension",
    });
    const api = createPluginExtensionApi("tooty-ai");
    const input = {
      scope: { kind: "site" as const, siteId: "site-1" },
      action: "generate" as const,
      input: { sourceText: "Draft" },
      context: { surface: "api" as const, pluginId: "tooty-ai" },
      providerId: "openai",
    };

    const result = await api.core.ai.run(input);

    expect(mocks.createKernelForRequest).toHaveBeenCalledWith("site-1");
    expect(mocks.runAiRequest).toHaveBeenCalledWith({
      request: input,
      actorUserId: "user-1",
      providers,
    });
    expect(result).toMatchObject({
      ok: true,
      decision: "allow",
      traceId: "trace-extension",
    });
  });

  it("blocks core.ai.run when there is no authenticated session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const api = createPluginExtensionApi("tooty-ai");

    await expect(
      api.core.ai.run({
        scope: { kind: "network" },
        action: "generate",
        input: { sourceText: "Draft" },
        context: { surface: "api" },
      }),
    ).rejects.toThrow(/Not authenticated/i);
  });
});
