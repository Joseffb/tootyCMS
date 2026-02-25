import { beforeEach, describe, expect, it, vi } from "vitest";

const { accountsFindFirst, usersFindFirst } = vi.hoisted(() => ({
  accountsFindFirst: vi.fn(),
  usersFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      accounts: {
        findFirst: accountsFindFirst,
      },
      users: {
        findFirst: usersFindFirst,
      },
      cmsSettings: {
        findFirst: vi.fn(async () => null),
      },
    },
  },
}));

import { enforceOauthAccountLinkingPolicy } from "@/lib/auth";

describe("oauth account linking policy", () => {
  beforeEach(() => {
    accountsFindFirst.mockReset();
    usersFindFirst.mockReset();
  });

  it("allows sign-in when provider account is already linked", async () => {
    accountsFindFirst.mockResolvedValue({ userId: "user-1" });
    usersFindFirst.mockResolvedValue(null);

    const result = await enforceOauthAccountLinkingPolicy({
      providerId: "github",
      providerAccountId: "acct-1",
      oauthEmail: "",
      oauthUserId: "",
    });

    expect(result.allow).toBe(true);
  });

  it("blocks sign-in when provider account is unlinked and email is missing", async () => {
    accountsFindFirst.mockResolvedValue(null);

    const result = await enforceOauthAccountLinkingPolicy({
      providerId: "github",
      providerAccountId: "acct-1",
      oauthEmail: "",
      oauthUserId: "",
    });

    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.error).toMatch(/did not return an email/i);
    }
  });

  it("blocks unsafe auto-link when email already belongs to another user", async () => {
    accountsFindFirst.mockResolvedValue(null);
    usersFindFirst.mockResolvedValue({ id: "existing-user", authProvider: "native" });

    const result = await enforceOauthAccountLinkingPolicy({
      providerId: "google",
      providerAccountId: "acct-2",
      oauthEmail: "existing@example.com",
      oauthUserId: "oauth-user",
    });

    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.error).toMatch(/not linked/i);
    }
  });

  it("allows new oauth account when email is not in use", async () => {
    accountsFindFirst.mockResolvedValue(null);
    usersFindFirst.mockResolvedValue(null);

    const result = await enforceOauthAccountLinkingPolicy({
      providerId: "facebook",
      providerAccountId: "acct-3",
      oauthEmail: "new@example.com",
      oauthUserId: "new-user",
    });

    expect(result.allow).toBe(true);
  });

  it("allows continuation when oauth user id matches existing email owner", async () => {
    accountsFindFirst.mockResolvedValue(null);
    usersFindFirst.mockResolvedValue({ id: "oauth-user", authProvider: "native" });

    const result = await enforceOauthAccountLinkingPolicy({
      providerId: "apple",
      providerAccountId: "acct-4",
      oauthEmail: "same@example.com",
      oauthUserId: "oauth-user",
    });

    expect(result.allow).toBe(true);
  });
});
