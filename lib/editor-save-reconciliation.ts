type PreserveNewerLocalDraftInput = {
  latestUserMutationSequence: number;
  payloadUserMutationSequence: number;
  currentClientSignature: string;
  payloadSignature: string;
  lastSavedSignature: string;
};

export function shouldPreserveNewerLocalDraft(input: PreserveNewerLocalDraftInput) {
  if (input.latestUserMutationSequence <= input.payloadUserMutationSequence) return false;

  const currentClientSignature = String(input.currentClientSignature || "").trim();
  const payloadSignature = String(input.payloadSignature || "").trim();
  const lastSavedSignature = String(input.lastSavedSignature || "").trim();

  if (!currentClientSignature) return false;
  if (currentClientSignature === payloadSignature) return false;
  if (lastSavedSignature && currentClientSignature === lastSavedSignature) return false;

  return true;
}
