import { describe, expect, it } from "vitest";
import { resolveAuthenticatedDisplayName, sanitizePublicCommentMetadata } from "@/lib/comment-identity";

describe("comment identity rules", () => {
  it("uses display_name for authenticated identity", () => {
    expect(
      resolveAuthenticatedDisplayName({
        displayName: "Public Alias",
        username: "internal_user",
      }),
    ).toBe("Public Alias");
  });

  it("falls back to username when display_name is missing", () => {
    expect(
      resolveAuthenticatedDisplayName({
        displayName: "",
        username: "internal_user",
      }),
    ).toBe("internal_user");
  });

  it("never falls back to legal name or email fields", () => {
    expect(
      resolveAuthenticatedDisplayName({
        displayName: "",
        username: "",
      }),
    ).toBe("");
  });

  it("strips email-shaped metadata from public payloads", () => {
    const sanitized = sanitizePublicCommentMetadata({
      author_display_name: "Anon",
      author_email: "anon@example.com",
      email: "leak@example.com",
      reviewer_email: "admin@example.com",
      note: "ok",
    });
    expect(sanitized).toEqual({
      author_display_name: "Anon",
      note: "ok",
    });
  });

  it("returns empty metadata object when source is not an object", () => {
    expect(sanitizePublicCommentMetadata(null)).toEqual({});
    expect(sanitizePublicCommentMetadata("not-an-object")).toEqual({});
  });

  it("skips empty metadata keys", () => {
    const sanitized = sanitizePublicCommentMetadata({
      "   ": "ignore-me",
      ok: "keep-me",
    });
    expect(sanitized).toEqual({ ok: "keep-me" });
  });
});
