import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createCoreProfile: vi.fn(),
  readCoreProfile: vi.fn(),
  updateCoreProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/core-profile", () => ({
  createCoreProfile: mocks.createCoreProfile,
  readCoreProfile: mocks.readCoreProfile,
  updateCoreProfile: mocks.updateCoreProfile,
}));

import { createPluginExtensionApi, createThemeExtensionApi } from "@/lib/extension-api";

describe("core profile extension api", () => {
  afterEach(() => {
    mocks.getSession.mockReset();
    mocks.createCoreProfile.mockReset();
    mocks.readCoreProfile.mockReset();
    mocks.updateCoreProfile.mockReset();
  });

  it("routes invoke-style core.profile.read calls through the profile spine", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.readCoreProfile.mockResolvedValue({ id: "user-1", displayName: "Admin Display" });
    const api = createPluginExtensionApi("profile-plugin");

    const result = await api.core.invoke("core.profile.read");

    expect(mocks.readCoreProfile).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({ id: "user-1", displayName: "Admin Display" });
  });

  it("routes invoke-style core.profile.update calls through the profile spine", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.updateCoreProfile.mockResolvedValue({ id: "user-1", displayName: "Updated Display" });
    const api = createPluginExtensionApi("profile-plugin");

    const result = await api.core.invoke("core.profile.update", { displayName: "Updated Display" });

    expect(mocks.updateCoreProfile).toHaveBeenCalledWith("user-1", { displayName: "Updated Display" });
    expect(result).toEqual({ id: "user-1", displayName: "Updated Display" });
  });

  it("blocks theme-side profile writes while allowing reads", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.readCoreProfile.mockResolvedValue({ id: "user-1", displayName: "Admin Display" });
    const api = createThemeExtensionApi("theme-1");

    await expect(api.core.profile.create({ displayName: "x" })).rejects.toThrow(/theme-guard/i);
    await expect(api.core.profile.update({ displayName: "x" })).rejects.toThrow(/theme-guard/i);
    await expect(api.core.profile.read()).resolves.toEqual({ id: "user-1", displayName: "Admin Display" });
  });
});
