import { describe, expect, it } from "vitest";

import {
  EDITOR_TEXT_INPUT_COMMIT_WINDOW_MS,
  EDITOR_TEXT_INPUT_GESTURE_WINDOW_MS,
  readEditorTextInputMeta,
  shouldAcceptEditorTextFieldCommit,
  shouldAcceptEditorTextFieldMutation,
} from "@/lib/editor-text-input";

describe("editor text input gating", () => {
  it("rejects text field changes when there is no recent local gesture and the field is not focused", () => {
    expect(
      shouldAcceptEditorTextFieldMutation({
        currentValue: "Title",
        nextValue: "Title 2",
        recentGestureAt: 0,
        fieldFocused: false,
      }),
    ).toBe(false);
  });

  it("rejects passive field changes without a recent gesture", () => {
    expect(
      shouldAcceptEditorTextFieldMutation({
        currentValue: "Title",
        nextValue: "Restored Title",
        recentGestureAt: 0,
        now: 10_000,
        fieldFocused: false,
      }),
    ).toBe(false);
  });

  it("accepts field mutations shortly after a recent gesture", () => {
    expect(
      shouldAcceptEditorTextFieldMutation({
        currentValue: "Title",
        nextValue: "Title 2",
        recentGestureAt: 10_000,
        now: 10_000 + EDITOR_TEXT_INPUT_GESTURE_WINDOW_MS - 1,
      }),
    ).toBe(true);
  });

  it("accepts focused trusted text field mutations without a recent gesture window", () => {
    expect(
      shouldAcceptEditorTextFieldMutation({
        currentValue: "Title",
        nextValue: "Title 2",
        recentGestureAt: 0,
        trusted: true,
        fieldFocused: true,
      }),
    ).toBe(true);
  });

  it("rejects delayed slug commits after the commit window expires", () => {
    expect(
      shouldAcceptEditorTextFieldCommit({
        currentValue: "hello",
        nextValue: "hello-world",
        recentGestureAt: 10_000,
        now: 10_000 + EDITOR_TEXT_INPUT_COMMIT_WINDOW_MS + 1,
      }),
    ).toBe(false);
  });

  it("parses native input metadata defensively", () => {
    expect(readEditorTextInputMeta(undefined)).toEqual({ inputType: "", trusted: false });
    expect(
      readEditorTextInputMeta({
        inputType: "insertText",
        isTrusted: true,
      } as unknown as Event),
    ).toEqual({ inputType: "insertText", trusted: true });
  });
});
