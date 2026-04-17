// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import TootyAiWorkspace from "@/plugins/tooty-ai/workspace";

const fetchMock = vi.fn();

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("Tooty AI workspace", () => {
  it("renders provider health in the providers tab", () => {
    render(
      <TootyAiWorkspace
        initialTab="providers"
        siteId="site-1"
        canRunAssist
        providers={[
          {
            id: "openai",
            ownerType: "core",
            ownerId: "core",
            actions: ["generate", "rewrite"],
            health: { ok: true },
          },
          {
            id: "anthropic",
            ownerType: "core",
            ownerId: "core",
            actions: ["summarize"],
            health: { ok: false, error: "Missing key" },
          },
        ]}
      />,
    );

    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("anthropic")).toBeTruthy();
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText("Missing key")).toBeTruthy();
  });

  it("runs assist requests through /api/ai/run and renders the governed output preview", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          decision: "allow",
          output: { kind: "text", text: "Workspace output" },
          providerId: "openai",
          model: "gpt-4o-mini",
          traceId: "trace-workspace",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <TootyAiWorkspace
        initialTab="assist"
        siteId="site-1"
        canRunAssist
        providers={[
          {
            id: "openai",
            ownerType: "core",
            ownerId: "core",
            actions: ["generate", "rewrite", "summarize"],
            health: { ok: true },
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Make it concise" },
    });
    fireEvent.change(screen.getByLabelText("Source Text"), {
      target: { value: "Draft source text" },
    });
    fireEvent.change(screen.getByLabelText("Context Text"), {
      target: { value: "Homepage hero" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Assist" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      scope: { kind: "site", siteId: "site-1" },
      action: "generate",
      input: {
        sourceText: "Draft source text",
        instructionText: "Make it concise",
        contextText: "Homepage hero",
      },
      context: {
        surface: "plugin_workspace",
        pluginId: "tooty-ai",
      },
      providerId: "openai",
    });

    await screen.findByText("Workspace output");
    expect(screen.getByText(/Trace ID: trace-workspace/)).toBeTruthy();
  });
});
