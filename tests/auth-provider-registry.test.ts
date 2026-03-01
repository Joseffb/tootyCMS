import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createKernelForRequestMock,
  getSettingsByKeysMock,
  getSettingByKeyMock,
  getUserMetaValueMock,
} = vi.hoisted(() => ({
  createKernelForRequestMock: vi.fn(),
  getSettingsByKeysMock: vi.fn(),
  getSettingByKeyMock: vi.fn(),
  getUserMetaValueMock: vi.fn(),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: createKernelForRequestMock,
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingsByKeys: getSettingsByKeysMock,
  getSettingByKey: getSettingByKeyMock,
}));

vi.mock("@/lib/user-meta", () => ({
  getUserMetaValue: getUserMetaValueMock,
}));

vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      accounts: {
        findFirst: vi.fn(async () => null),
      },
      users: {
        findFirst: vi.fn(async () => null),
      },
    },
  },
}));

import { getAuthOptions } from "@/lib/auth";

describe("auth provider registry", () => {
  beforeEach(() => {
    createKernelForRequestMock.mockReset();
    getSettingsByKeysMock.mockReset();
    getSettingByKeyMock.mockReset();
    getUserMetaValueMock.mockReset();
    getSettingsByKeysMock.mockResolvedValue({
      "plugin_auth-google_config": JSON.stringify({
        clientId: "google-client",
        clientSecret: "google-secret",
      }),
    });
    getSettingByKeyMock.mockResolvedValue("");
    getUserMetaValueMock.mockResolvedValue("");
  });

  it("builds external auth providers from the finalized kernel registry", async () => {
    const providerCallback = vi.fn(async () => ({ allow: true }));
    const createAuthProvider = vi.fn(async () => ({ id: "google" }));
    createKernelForRequestMock.mockResolvedValue({
      getAllPluginAuthProviders: () => [
        {
          pluginId: "auth-google",
          id: "google",
          type: "oauth",
          authorize: async ({ config }: any) => ({
            ok: Boolean(config.clientId && config.clientSecret),
            config,
          }),
          callback: providerCallback,
          mapProfile: async (profile: Record<string, unknown>) => ({
            id: String(profile.sub || ""),
          }),
          createAuthProvider,
        },
      ],
    });

    const options = await getAuthOptions();

    expect(createAuthProvider).toHaveBeenCalledOnce();
    expect(options.providers).toHaveLength(2);
    expect(options.providers?.[0]).toMatchObject({ id: "google" });
    expect(options.providers?.[1]).toMatchObject({ id: "credentials" });

    const result = await options.callbacks?.signIn?.({
      account: { provider: "google", providerAccountId: "acct-1" } as any,
      user: { id: "user-1", email: "user@example.com" } as any,
      profile: { sub: "sub-1" } as any,
      email: undefined as any,
      credentials: undefined as any,
    });

    expect(providerCallback).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it("does not expose external providers when none register", async () => {
    createKernelForRequestMock.mockResolvedValue({
      getAllPluginAuthProviders: () => [],
    });

    const options = await getAuthOptions();

    expect(options.providers).toHaveLength(1);
    expect(options.providers?.[0]).toMatchObject({ id: "credentials" });
  });
});
