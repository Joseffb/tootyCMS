import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createKernelForRequest: vi.fn(),
  runAiRequest: vi.fn(),
  evaluateBotIdRoute: vi.fn(),
  trace: vi.fn(),
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

vi.mock("@/lib/botid", () => ({
  evaluateBotIdRoute: mocks.evaluateBotIdRoute,
}));

vi.mock("@/lib/debug", () => ({
  trace: mocks.trace,
}));

import { POST } from "@/app/api/ai/run/route";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.createKernelForRequest.mockReset();
  mocks.runAiRequest.mockReset();
  mocks.evaluateBotIdRoute.mockReset();
  mocks.trace.mockReset();
});

function makeAllowedBotId() {
  return {
    allowed: true,
    mode: "allow",
    reason: "allowed",
  };
}

describe("POST /api/ai/run", () => {
  it("returns 401 when the user is not authenticated", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Unauthorized",
      traceId: expect.any(String),
    });
  });

  it("returns 403 when BotID blocks the route", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.evaluateBotIdRoute.mockResolvedValue({
      allowed: false,
      mode: "block",
      reason: "bot",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-tooty-botid-mode")).toBe("block");
    expect(response.headers.get("x-tooty-botid-result")).toBe("bot");
  });

  it("returns 400 for invalid JSON bodies", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.evaluateBotIdRoute.mockResolvedValue(makeAllowedBotId());

    const response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid JSON body.",
    });
  });

  it("passes site-scoped requests through the kernel and preserves the incoming trace id", async () => {
    const kernel = { getAllAiProviders: vi.fn(() => [{ id: "openai" }]) };
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.evaluateBotIdRoute.mockResolvedValue(makeAllowedBotId());
    mocks.createKernelForRequest.mockResolvedValue(kernel);
    mocks.runAiRequest.mockResolvedValue({
      ok: true,
      decision: "allow",
      output: { kind: "text", text: "Generated" },
      providerId: "openai",
      model: "gpt-4o-mini",
      traceId: "trace-site",
    });

    const body = {
      scope: { kind: "site", siteId: "site-1" },
      action: "generate",
      input: { sourceText: "Draft" },
      context: { surface: "api", pluginId: "tooty-ai" },
      providerId: "openai",
    };
    const response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": "trace-site",
        },
        body: JSON.stringify(body),
      }),
    );

    expect(mocks.createKernelForRequest).toHaveBeenCalledWith("site-1");
    expect(mocks.runAiRequest).toHaveBeenCalledWith({
      request: body,
      actorUserId: "user-1",
      providers: [{ id: "openai" }],
      traceId: "trace-site",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-tooty-botid-mode")).toBe("allow");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      decision: "allow",
      traceId: "trace-site",
    });
  });

  it("returns 200 for guarded reject decisions without output", async () => {
    const kernel = { getAllAiProviders: vi.fn(() => [{ id: "openai" }]) };
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.evaluateBotIdRoute.mockResolvedValue(makeAllowedBotId());
    mocks.createKernelForRequest.mockResolvedValue(kernel);
    mocks.runAiRequest.mockResolvedValue({
      ok: true,
      decision: "reject",
      providerId: "openai",
      model: "gpt-4o-mini",
      traceId: "trace-reject",
      policyFlags: ["empty_output"],
    });

    const response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "network" },
          action: "classify",
          input: { sourceText: "Classify me" },
          context: { surface: "api" },
        }),
      }),
    );

    expect(mocks.createKernelForRequest).toHaveBeenCalledWith(undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      decision: "reject",
      traceId: "trace-reject",
    });
  });

  it("maps common spine failures to the correct HTTP statuses", async () => {
    const kernel = { getAllAiProviders: vi.fn(() => []) };
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.evaluateBotIdRoute.mockResolvedValue(makeAllowedBotId());
    mocks.createKernelForRequest.mockResolvedValue(kernel);

    mocks.runAiRequest.mockResolvedValueOnce({
      ok: false,
      error: "Daily AI quota exceeded for the current scope.",
      traceId: "trace-quota",
    });
    let response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { kind: "network" }, action: "generate", input: { sourceText: "A" }, context: { surface: "api" } }),
      }),
    );
    expect(response.status).toBe(429);

    mocks.runAiRequest.mockResolvedValueOnce({
      ok: false,
      error: "You do not have permission to use AI for this scope.",
      traceId: "trace-permission",
    });
    response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { kind: "network" }, action: "generate", input: { sourceText: "B" }, context: { surface: "api" } }),
      }),
    );
    expect(response.status).toBe(403);

    mocks.runAiRequest.mockResolvedValueOnce({
      ok: false,
      error: 'Unknown AI provider "ghost".',
      traceId: "trace-unknown-provider",
    });
    response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { kind: "network" }, action: "generate", input: { sourceText: "C" }, context: { surface: "api" } }),
      }),
    );
    expect(response.status).toBe(400);

    mocks.runAiRequest.mockResolvedValueOnce({
      ok: false,
      error: 'Provider-shaped field "messages" is not allowed in ai.run().',
      traceId: "trace-provider-shaped",
    });
    response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { kind: "network" }, action: "generate", input: { sourceText: "C2" }, context: { surface: "api" } }),
      }),
    );
    expect(response.status).toBe(400);

    mocks.runAiRequest.mockResolvedValueOnce({
      ok: false,
      error: "No AI provider is configured.",
      traceId: "trace-provider-config",
    });
    response = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { kind: "network" }, action: "generate", input: { sourceText: "D" }, context: { surface: "api" } }),
      }),
    );
    expect(response.status).toBe(503);
  });
});
