import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnthropicProvider, createOpenAiProvider, resolveDefaultModel } from "@/lib/ai-providers";

const envSnapshot = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  Object.assign(process.env, envSnapshot);
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("AI provider adapters", () => {
  it("maps OpenAI chat completions into the normalized provider result", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [
            {
              message: {
                content: "OpenAI output",
              },
            },
          ],
          usage: {
            prompt_tokens: 21,
            completion_tokens: 7,
            total_tokens: 28,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await createOpenAiProvider().run({
      action: "generate",
      sourceText: "Draft",
      instructionText: "Polish it",
      contextText: "Blog",
      maxOutputChars: 1200,
      model: "gpt-4o-mini",
      traceId: "trace-openai",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer openai-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "gpt-4o-mini",
      messages: [
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user" }),
      ],
    });
    expect(result).toEqual({
      ok: true,
      outputText: "OpenAI output",
      model: "gpt-4o-mini",
      usage: {
        inputTokens: 21,
        outputTokens: 7,
        totalTokens: 28,
      },
      metadata: expect.any(Object),
    });
  });

  it("maps Anthropic messages responses into the normalized provider result", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "Anthropic output" }],
          usage: {
            input_tokens: 11,
            output_tokens: 4,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await createAnthropicProvider().run({
      action: "summarize",
      sourceText: "Long source",
      instructionText: "Keep it short",
      contextText: "Newsletter",
      maxOutputChars: 800,
      model: "claude-sonnet-4-20250514",
      traceId: "trace-anthropic",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("anthropic-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "claude-sonnet-4-20250514",
      messages: [expect.objectContaining({ role: "user" })],
    });
    expect(result).toEqual({
      ok: true,
      outputText: "Anthropic output",
      model: "claude-sonnet-4-20250514",
      usage: {
        inputTokens: 11,
        outputTokens: 4,
        totalTokens: 15,
      },
      metadata: expect.any(Object),
    });
  });

  it("returns normalized configuration failures when provider credentials are missing", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      createOpenAiProvider().run({
        action: "generate",
        sourceText: "Test",
        maxOutputChars: 100,
        model: "gpt-4o-mini",
        traceId: "trace-openai-missing",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "OPENAI_API_KEY is not configured.",
    });

    await expect(
      createAnthropicProvider().run({
        action: "generate",
        sourceText: "Test",
        maxOutputChars: 100,
        model: "claude-sonnet-4-20250514",
        traceId: "trace-anthropic-missing",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "ANTHROPIC_API_KEY is not configured.",
    });
  });

  it("resolves default models from environment by provider id", () => {
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.ANTHROPIC_MODEL = "claude-test";

    expect(resolveDefaultModel("openai")).toBe("gpt-test");
    expect(resolveDefaultModel("anthropic")).toBe("claude-test");
  });
});
