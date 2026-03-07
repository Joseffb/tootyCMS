import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const setWhere = vi.fn();
  const setSet = vi.fn(() => ({ where: setWhere }));
  const update = vi.fn(() => ({ set: setSet }));

  return {
    db: {
      query: {
        users: {
          findFirst: vi.fn(),
        },
      },
      update,
    },
    setWhere,
    setSet,
    update,
    getUserMetaValue: vi.fn(),
    setUserMetaValue: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  default: mocks.db,
}));

vi.mock("@/lib/user-meta", () => ({
  getUserMetaValue: mocks.getUserMetaValue,
  setUserMetaValue: mocks.setUserMetaValue,
}));

import { readCoreProfile, updateCoreProfile } from "@/lib/core-profile";

describe("core profile", () => {
  afterEach(() => {
    mocks.db.query.users.findFirst.mockReset();
    mocks.update.mockClear();
    mocks.setSet.mockClear();
    mocks.setWhere.mockReset();
    mocks.getUserMetaValue.mockReset();
    mocks.setUserMetaValue.mockReset();
  });

  it("preserves unspecified core fields during partial updates", async () => {
    mocks.setWhere.mockResolvedValue(undefined);
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "user-1",
      name: "Admin User",
      email: "admin@example.com",
      image: "",
      role: "network admin",
      username: "admin",
      gh_username: "",
      passwordHash: "hash",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    mocks.getUserMetaValue.mockImplementation(async (_userId: string, key: string) =>
      key === "display_name" ? "Admin Display" : "",
    );

    const profile = await updateCoreProfile("user-1", {
      displayName: "Updated Display",
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.setUserMetaValue).toHaveBeenCalledWith("user-1", "display_name", "Updated Display");
    expect(profile?.email).toBe("admin@example.com");
  });

  it("rejects invalid profile image urls at the core profile boundary", async () => {
    await expect(
      updateCoreProfile("user-1", {
        profileImageUrl: "ftp://example.com/profile.png",
      }),
    ).rejects.toThrow(/profile image must be an absolute http\(s\) url or a root-relative path/i);
  });

  it("returns explicit and resolved image data when reading a profile", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "user-1",
      name: "Admin User",
      email: "admin@example.com",
      image: "https://provider.example.com/avatar.png",
      role: "network admin",
      username: "admin",
      gh_username: "",
      passwordHash: "hash",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    mocks.getUserMetaValue.mockImplementation(async (_userId: string, key: string) =>
      key === "display_name" ? "Admin Display" : "https://cdn.example.com/profile.png",
    );

    const profile = await readCoreProfile("user-1");

    expect(profile?.profileImageUrl).toBe("https://cdn.example.com/profile.png");
    expect(profile?.resolvedImageUrl).toBe("https://cdn.example.com/profile.png");
  });
});
