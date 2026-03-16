import { describe, expect, it } from "vitest";

import { shouldPreserveNewerLocalDraft } from "@/lib/editor-save-reconciliation";

describe("shouldPreserveNewerLocalDraft", () => {
  it("does not preserve when there is no newer mutation sequence", () => {
    expect(
      shouldPreserveNewerLocalDraft({
        latestUserMutationSequence: 3,
        payloadUserMutationSequence: 3,
        currentClientSignature: "current",
        payloadSignature: "payload",
        lastSavedSignature: "saved",
      }),
    ).toBe(false);
  });

  it("does not preserve when the current client signature matches the payload signature", () => {
    expect(
      shouldPreserveNewerLocalDraft({
        latestUserMutationSequence: 4,
        payloadUserMutationSequence: 3,
        currentClientSignature: "payload-signature",
        payloadSignature: "payload-signature",
        lastSavedSignature: "saved-signature",
      }),
    ).toBe(false);
  });

  it("does not preserve when the current client signature matches the last saved signature", () => {
    expect(
      shouldPreserveNewerLocalDraft({
        latestUserMutationSequence: 4,
        payloadUserMutationSequence: 3,
        currentClientSignature: "saved-signature",
        payloadSignature: "payload-signature",
        lastSavedSignature: "saved-signature",
      }),
    ).toBe(false);
  });

  it("preserves when there is a newer mutation with a genuinely different client signature", () => {
    expect(
      shouldPreserveNewerLocalDraft({
        latestUserMutationSequence: 5,
        payloadUserMutationSequence: 3,
        currentClientSignature: "new-local-signature",
        payloadSignature: "payload-signature",
        lastSavedSignature: "saved-signature",
      }),
    ).toBe(true);
  });
});
