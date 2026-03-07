import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  cookies: vi.fn(),
  usersFindFirst: vi.fn(),
  accountsFindFirst: vi.fn(),
  createKernelForRequest: vi.fn(),
  getSettingsByKeys: vi.fn(),
  getSettingByKey: vi.fn(),
  getUserMetaValue: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config) => ({ id: "credentials", ...config })),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingsByKeys: mocks.getSettingsByKeys,
  getSettingByKey: mocks.getSettingByKey,
}));

vi.mock("@/lib/user-meta", () => ({
  getUserMetaValue: mocks.getUserMetaValue,
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      accounts: {
        findFirst: mocks.accountsFindFirst,
      },
      users: {
        findFirst: mocks.usersFindFirst,
      },
    },
  },
}));

import { getSession } from "@/lib/auth";

describe("auth session hardening", () => {
  beforeEach(() => {
    mocks.getServerSession.mockReset();
    mocks.cookies.mockReset();
    mocks.usersFindFirst.mockReset();
    mocks.accountsFindFirst.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.getSettingsByKeys.mockReset();
    mocks.getSettingByKey.mockReset();
    mocks.getUserMetaValue.mockReset();

    mocks.createKernelForRequest.mockResolvedValue({
      getAllPluginAuthProviders: () => [],
    });
    mocks.getSettingsByKeys.mockResolvedValue({});
    mocks.getSettingByKey.mockResolvedValue("");
    mocks.getUserMetaValue.mockResolvedValue("");
    mocks.accountsFindFirst.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue({
      get: () => undefined,
    });
  });

  it("returns null when the backing user row no longer exists", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "deleted-user",
        name: "Ghost",
        email: "ghost@example.com",
        image: null,
      },
    });
    mocks.usersFindFirst.mockResolvedValue(null);

    await expect(getSession()).resolves.toBeNull();
  });

  it("refreshes the session user from the canonical network user row", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Old Name",
        email: "old@example.com",
        image: null,
      },
    });
    mocks.getUserMetaValue.mockImplementation(async (_userId: string, key: string) =>
      key === "profile_image_url" ? "https://cdn.example.com/profile.png" : "",
    );
    mocks.usersFindFirst.mockResolvedValue({
      id: "user-1",
      name: "Admin User",
      email: "admin@example.com",
      image: "provider-avatar.png",
      role: "network admin",
      username: "admin",
      gh_username: "",
    });

    await expect(getSession()).resolves.toMatchObject({
      user: {
        id: "user-1",
        name: "Admin User",
        email: "admin@example.com",
        image: "https://cdn.example.com/profile.png",
        role: "network admin",
        username: "admin",
        profileImageUrl: "https://cdn.example.com/profile.png",
      },
    });
  });
});
