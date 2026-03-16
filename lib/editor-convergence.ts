export const EDITOR_CONVERGENCE_WINDOW_MS = 30_000;

type EditorConvergenceInput = {
  currentClientSignature: string;
  lastQueuedSignature: string;
  lastSavedSignature: string;
  incomingSignature: string;
  samePost: boolean;
  lastLocalMutationAt: number;
  lastRecoveredCacheAt: number;
  shouldUseCachedEditorState: boolean;
  now?: number;
};

export function shouldMarkEditorStateDirty(input: {
  nextSignature: string;
  lastSavedSignature: string;
}) {
  if (!input.lastSavedSignature) return true;
  return input.nextSignature !== input.lastSavedSignature;
}

export function computeEditorConvergence(input: EditorConvergenceInput) {
  const now = typeof input.now === "number" ? input.now : Date.now();
  const lastKnownEditorMutationAt = Math.max(
    input.lastLocalMutationAt,
    input.lastRecoveredCacheAt,
  );
  const withinRecentWindow =
    lastKnownEditorMutationAt > 0 &&
    now - lastKnownEditorMutationAt < EDITOR_CONVERGENCE_WINDOW_MS;
  const hasUnsavedLocalState =
    input.samePost &&
    (input.lastSavedSignature
      ? input.currentClientSignature !== input.lastSavedSignature
      : input.currentClientSignature !== input.incomingSignature);

  const preserveLocalDraft =
    input.samePost &&
    hasUnsavedLocalState &&
    input.lastQueuedSignature.length > 0 &&
    input.lastQueuedSignature !== input.lastSavedSignature;

  const preserveRecentLocalDraft =
    input.samePost &&
    hasUnsavedLocalState &&
    input.lastLocalMutationAt > 0 &&
    now - input.lastLocalMutationAt < EDITOR_CONVERGENCE_WINDOW_MS &&
    input.currentClientSignature !== input.incomingSignature;

  const preserveStaleIncomingPost =
    input.samePost &&
    hasUnsavedLocalState &&
    input.lastSavedSignature.length > 0 &&
    withinRecentWindow &&
    input.incomingSignature !== input.lastSavedSignature;

  const shouldPreserveLocalState =
    preserveLocalDraft ||
    preserveRecentLocalDraft ||
    (preserveStaleIncomingPost && !input.shouldUseCachedEditorState);

  return {
    hasUnsavedLocalState,
    lastKnownEditorMutationAt,
    preserveLocalDraft,
    preserveRecentLocalDraft,
    preserveStaleIncomingPost,
    shouldPreserveLocalState,
  };
}
