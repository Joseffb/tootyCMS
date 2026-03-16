export const EDITOR_TEXT_INPUT_GESTURE_WINDOW_MS = 2_500;
export const EDITOR_TEXT_INPUT_COMMIT_WINDOW_MS = 60_000;

export type EditorTextInputMeta = {
  inputType: string;
  trusted: boolean;
};

export function readEditorTextInputMeta(event: Event | null | undefined): EditorTextInputMeta {
  if (!event) {
    return {
      inputType: "",
      trusted: false,
    };
  }

  const candidate = event as Event & {
    inputType?: unknown;
    isTrusted?: unknown;
  };

  return {
    inputType: typeof candidate.inputType === "string" ? candidate.inputType.trim() : "",
    trusted: candidate.isTrusted !== false,
  };
}

export function shouldAcceptEditorFieldMutation(input: {
  currentValue: string | boolean;
  nextValue: string | boolean;
  recentGestureAt: number;
  trusted?: boolean;
  fieldFocused?: boolean;
  now?: number;
}) {
  const currentValue =
    typeof input.currentValue === "boolean" ? String(input.currentValue) : String(input.currentValue || "");
  const nextValue =
    typeof input.nextValue === "boolean" ? String(input.nextValue) : String(input.nextValue || "");
  if (nextValue === currentValue) return false;
  if (input.trusted === false) return false;
  if (input.fieldFocused === false) return false;

  const now = typeof input.now === "number" ? input.now : Date.now();
  return input.recentGestureAt > 0 && now - input.recentGestureAt <= EDITOR_TEXT_INPUT_GESTURE_WINDOW_MS;
}

export function shouldAcceptEditorTextFieldMutation(input: {
  currentValue: string;
  nextValue: string;
  recentGestureAt: number;
  trusted?: boolean;
  fieldFocused?: boolean;
  now?: number;
}) {
  if (shouldAcceptEditorFieldMutation(input)) {
    return true;
  }

  const currentValue = String(input.currentValue || "");
  const nextValue = String(input.nextValue || "");
  if (nextValue === currentValue) return false;
  if (input.trusted === false) return false;

  // Focused trusted text-input events can legitimately arrive without an
  // immediately preceding key/pointer gesture window, such as Playwright
  // fill(), browser-assisted text entry, or IME reconciliation. Those
  // should still be treated as direct user intent.
  return input.fieldFocused !== false;
}

export function shouldAcceptEditorTextFieldCommit(input: {
  currentValue: string;
  nextValue: string;
  recentGestureAt: number;
  trusted?: boolean;
  now?: number;
}) {
  const currentValue = String(input.currentValue || "");
  const nextValue = String(input.nextValue || "");
  if (nextValue === currentValue) return false;
  if (input.trusted === false) return false;

  const now = typeof input.now === "number" ? input.now : Date.now();
  return input.recentGestureAt > 0 && now - input.recentGestureAt <= EDITOR_TEXT_INPUT_COMMIT_WINDOW_MS;
}
