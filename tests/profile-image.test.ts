import { describe, expect, it } from "vitest";

import {
  PROFILE_IMAGE_META_KEY,
  buildGeneratedAvatarUrl,
  normalizeProfileImageUrl,
  resolveProfileImageUrl,
} from "@/lib/profile-image";

describe("profile image helpers", () => {
  it("uses the canonical meta key", () => {
    expect(PROFILE_IMAGE_META_KEY).toBe("profile_image_url");
  });

  it("accepts absolute http(s) and root-relative profile image urls", () => {
    expect(normalizeProfileImageUrl("https://cdn.example.com/avatar.png")).toBe(
      "https://cdn.example.com/avatar.png",
    );
    expect(normalizeProfileImageUrl("/media/avatar.png")).toBe("/media/avatar.png");
  });

  it("rejects unsupported profile image urls", () => {
    expect(normalizeProfileImageUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeProfileImageUrl("ftp://example.com/avatar.png")).toBeNull();
  });

  it("prefers profile image url over provider image and generated fallback", () => {
    expect(
      resolveProfileImageUrl({
        profileImageUrl: "https://cdn.example.com/custom.png",
        providerImageUrl: "https://provider.example.com/avatar.png",
        email: "admin@example.com",
      }),
    ).toBe("https://cdn.example.com/custom.png");
  });

  it("falls back to provider image then generated avatar", () => {
    expect(
      resolveProfileImageUrl({
        profileImageUrl: "",
        providerImageUrl: "https://provider.example.com/avatar.png",
        email: "admin@example.com",
      }),
    ).toBe("https://provider.example.com/avatar.png");

    expect(
      resolveProfileImageUrl({
        profileImageUrl: "",
        providerImageUrl: "",
        email: "admin@example.com",
      }),
    ).toBe(buildGeneratedAvatarUrl("admin@example.com"));
  });
});
