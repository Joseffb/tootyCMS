import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProviderDescriptor } from "@/lib/ai-contracts";

const mocks = vi.hoisted(() => ({
  userCan: vi.fn(),
  trace: vi.fn(),
  kvIncr: vi.fn(),
  kvExpire: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  userCan: mocks.userCan,
}));

vi.mock("@/lib/debug", () => ({
  trace: mocks.trace,
}));

vi.mock("@vercel/kv", () => ({
  kv: {
    incr: mocks.kvIncr,
    expire: mocks.kvExpire,
  },
}));

import { runAiRequest } from "@/lib/ai-spine";

const envSnapshot = { ...process.env };

function makeProvider(
  overrides: Partial<AiProviderDescriptor> & {
    run?: AiProviderDescriptor["run"];
  } = {},
): AiProviderDescriptor {
  return {
    id: "openai",
    actions: ["generate", "rewrite", "summarize", "classify"],
    ownerType: "core",
    ownerId: "core",
    run: vi.fn(async () => ({
      ok: true,
      outputText: "Generated output",
      model: "gpt-4o-mini",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })),
    ...overrides,
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    scope: { kind: "site", siteId: "site-1" },
    action: "generate",
    input: {
      sourceText: "Draft source text",
    },
    context: {
      surface: "api",
      pluginId: "tooty-ai",
    },
    providerId: "openai",
    ...overrides,
  };
}

afterEach(() => {
  Object.assign(process.env, envSnapshot);
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  mocks.userCan.mockReset();
  mocks.trace.mockReset();
  mocks.kvIncr.mockReset();
  mocks.kvExpire.mockReset();
});

describe("AI spine", () => {
  it("rejects provider-shaped request fields before execution", async () => {
    const result = await runAiRequest({
      request: {
        ...makeRequest(),
        messages: [{ role: "user", content: "hi" }],
      },
      actorUserId: "user-1",
      providers: [makeProvider()],
      traceId: "trace-provider-shaped",
    });

    expect(result).toEqual({
      ok: false,
      error: 'Provider-shaped field "messages" is not allowed in ai.run().',
      traceId: "trace-provider-shaped",
    });
  });

  it("routes network-scoped authorization through network.ai.use and returns allow", async () => {
    const provider = makeProvider();
    mocks.userCan.mockResolvedValue(true);

    const result = await runAiRequest({
      request: makeRequest({
        scope: { kind: "network" },
        providerId: "openai",
      }),
      actorUserId: "user-1",
      providers: [provider],
      traceId: "trace-network",
    });

    expect(mocks.userCan).toHaveBeenCalledWith("network.ai.use", "user-1");
    expect(provider.run).toHaveBeenCalledWith({
      action: "generate",
      sourceText: "Draft source text",
      instructionText: undefined,
      contextText: undefined,
      maxOutputChars: 5000,
      model: "gpt-4o-mini",
      traceId: "trace-network",
    });
    expect(result).toMatchObject({
      ok: true,
      decision: "allow",
      providerId: "openai",
      model: "gpt-4o-mini",
      traceId: "trace-network",
      output: {
        kind: "text",
        text: "Generated output",
      },
    });
  });

  it("returns permission failures before quota or provider dispatch", async () => {
    const provider = makeProvider();
    mocks.userCan.mockResolvedValue(false);

    const result = await runAiRequest({
      request: makeRequest(),
      actorUserId: "user-2",
      providers: [provider],
      traceId: "trace-permission",
    });

    expect(result).toEqual({
      ok: false,
      error: "You do not have permission to use AI for this scope.",
      traceId: "trace-permission",
    });
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("returns modify when the guard sanitizes and truncates provider output", async () => {
    process.env.AI_OUTPUT_MAX_CHARS = "4";
    const provider = makeProvider({
      run: vi.fn(async () => ({
        ok: true,
        outputText: "\u0000 Hello world   ",
        model: "gpt-4o-mini",
      })),
    });
    mocks.userCan.mockResolvedValue(true);

    const result = await runAiRequest({
      request: makeRequest(),
      actorUserId: "user-3",
      providers: [provider],
      traceId: "trace-modify",
    });

    expect(result).toEqual({
      ok: true,
      decision: "modify",
      providerId: "openai",
      model: "gpt-4o-mini",
      traceId: "trace-modify",
      output: {
        kind: "text",
        text: "Hell",
      },
      policyFlags: ["output_sanitized", "output_truncated"],
    });
  });

  it("returns reject when the guarded output is empty", async () => {
    const provider = makeProvider({
      run: vi.fn(async () => ({
        ok: true,
        outputText: " \u0000 \n\t ",
        model: "gpt-4o-mini",
      })),
    });
    mocks.userCan.mockResolvedValue(true);

    const result = await runAiRequest({
      request: makeRequest(),
      actorUserId: "user-4",
      providers: [provider],
      traceId: "trace-reject",
    });

    expect(result).toEqual({
      ok: true,
      decision: "reject",
      providerId: "openai",
      model: "gpt-4o-mini",
      traceId: "trace-reject",
      usage: undefined,
      policyFlags: ["output_sanitized", "empty_output"],
    });
  });

  it("fails fast on kv_daily quota violations", async () => {
    process.env.AI_QUOTA_MODE = "kv_daily";
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "token";
    process.env.AI_KV_DAILY_LIMIT_SITE = "1";
    const provider = makeProvider();
    mocks.userCan.mockResolvedValue(true);
    mocks.kvIncr.mockResolvedValue(2);

    const result = await runAiRequest({
      request: makeRequest(),
      actorUserId: "user-5",
      providers: [provider],
      traceId: "trace-quota",
    });

    expect(mocks.kvIncr).toHaveBeenCalledOnce();
    expect(mocks.kvExpire).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "Daily AI quota exceeded for the current scope.",
      traceId: "trace-quota",
    });
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("fails when no provider is configured", async () => {
    mocks.userCan.mockResolvedValue(true);

    const result = await runAiRequest({
      request: makeRequest({ providerId: undefined }),
      actorUserId: "user-6",
      providers: [makeProvider()],
      traceId: "trace-provider-missing",
    });

    expect(result).toEqual({
      ok: false,
      error: "No AI provider is configured.",
      traceId: "trace-provider-missing",
    });
  });

  it("normalizes thrown provider adapter errors into governed failures", async () => {
    const provider = makeProvider({
      run: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    mocks.userCan.mockResolvedValue(true);

    const result = await runAiRequest({
      request: makeRequest(),
      actorUserId: "user-7",
      providers: [provider],
      traceId: "trace-provider-throw",
    });

    expect(result).toEqual({
      ok: false,
      error: "AI provider request failed: network down",
      traceId: "trace-provider-throw",
    });
  });
});
