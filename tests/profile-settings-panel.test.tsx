// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  updateOwnPassword: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
  updateOwnPassword: mocks.updateOwnPassword,
}));

afterEach(() => {
  cleanup();
  mocks.getProfile.mockReset();
  mocks.updateProfile.mockReset();
  mocks.updateOwnPassword.mockReset();
});

describe("profile settings panel", () => {
  it("renders the profile image field and preview", { timeout: 20_000 }, async () => {
    mocks.getProfile.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Admin User",
        displayName: "Admin Display",
        profileImageUrl: "https://cdn.example.com/profile.png",
        resolvedImageUrl: "https://cdn.example.com/profile.png",
        email: "admin@example.com",
        role: "network admin",
        hasNativePassword: true,
        forcePasswordChange: false,
        uploadSiteId: "site-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      authProviders: {
        available: [],
        native: { enabled: true, linked: true },
      },
      extensionSections: [],
    });

    const ProfileSettingsPanel = (await import("@/components/settings/profile-settings-panel")).default;
    render(await ProfileSettingsPanel({}));

    expect(screen.getByTestId("profile-image-input")).toHaveValue("https://cdn.example.com/profile.png");
    expect(screen.getByTestId("profile-image-preview-image")).toHaveAttribute("src", "https://cdn.example.com/profile.png");
  });

  it("defaults the display name field to the name when no explicit display name exists", async () => {
    mocks.getProfile.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Admin User",
        displayName: "",
        profileImageUrl: "",
        resolvedImageUrl: "https://avatar.vercel.sh/admin-user",
        email: "admin@example.com",
        role: "network admin",
        hasNativePassword: true,
        forcePasswordChange: false,
        uploadSiteId: "site-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      authProviders: {
        available: [],
        native: { enabled: true, linked: true },
      },
      extensionSections: [],
    });

    const ProfileSettingsPanel = (await import("@/components/settings/profile-settings-panel")).default;
    render(await ProfileSettingsPanel({}));

    const displayNameInput = document.querySelector('input[name="displayName"]') as HTMLInputElement | null;
    expect(displayNameInput?.value).toBe("Admin User");
  });
});
