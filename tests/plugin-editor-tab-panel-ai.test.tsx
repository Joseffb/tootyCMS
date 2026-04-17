// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import PluginEditorTabPanel, { type EditorPluginTabDescriptor } from "@/components/editor/plugin-editor-tab-panel";

const fetchMock = vi.fn();

function makeTab(fragmentOverrides: Record<string, unknown> = {}): EditorPluginTabDescriptor {
  return {
    id: "ai",
    label: "AI",
    order: 10,
    pluginId: "tooty-ai",
    pluginName: "Tooty AI",
    sections: [
      {
        id: "assist",
        title: "AI Assist",
        fragment: {
          kind: "text-tool",
          toolId: "rewrite-selection",
          title: "Rewrite Selection",
          action: "rewrite",
          source: "selection",
          applyActions: ["replace_selection", "insert_below"],
          submitLabel: "Run Tool",
          ...fragmentOverrides,
        },
        fields: [],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("PluginEditorTabPanel AI text tools", () => {
  it("runs the governed AI request and applies output through the editor callback", async () => {
    const onApplyAiText = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          decision: "modify",
          output: { kind: "text", text: "Rewritten output" },
          providerId: "openai",
          model: "gpt-4o-mini",
          traceId: "trace-editor",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <PluginEditorTabPanel
        tab={makeTab()}
        canEdit
        siteId="site-1"
        postId="post-1"
        dataDomainKey="post"
        metaEntries={[]}
        mediaItems={[]}
        onMetaEntriesChange={vi.fn()}
        openMediaPicker={vi.fn()}
        getEditorSelectionText={() => "Selected text"}
        getEditorContentText={() => "Full editor content"}
        onApplyAiText={onApplyAiText}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run Tool" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      scope: { kind: "site", siteId: "site-1" },
      action: "rewrite",
      input: {
        sourceText: "Selected text",
        instructionText: undefined,
        contextText: "Full editor content",
      },
      context: {
        surface: "editor_assist",
        pluginId: "tooty-ai",
        postId: "post-1",
        dataDomainKey: "post",
      },
    });

    await screen.findByText("Rewritten output");
    fireEvent.click(screen.getByRole("button", { name: "Replace Selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert Below" }));

    expect(onApplyAiText).toHaveBeenNthCalledWith(1, "replace_selection", "Rewritten output");
    expect(onApplyAiText).toHaveBeenNthCalledWith(2, "insert_below", "Rewritten output");
  });

  it("disables the tool instead of calling the route when no editor text is selected", () => {
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PluginEditorTabPanel
        tab={makeTab()}
        canEdit
        siteId="site-1"
        postId="post-1"
        dataDomainKey="post"
        metaEntries={[]}
        mediaItems={[]}
        onMetaEntriesChange={vi.fn()}
        openMediaPicker={vi.fn()}
        getEditorSelectionText={() => ""}
        getEditorContentText={() => "Full editor content"}
        onApplyAiText={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Run Tool" })).toBeDisabled();
    expect(screen.getByText(/"sourceText": ""/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run Tool" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
