import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usersFindFirst: vi.fn(),
  sitesFindFirst: vi.fn(),
  sitesFindMany: vi.fn(),
  domainPostsFindFirst: vi.fn(),
  getSiteUserRole: vi.fn(),
  isAdministrator: vi.fn(),
  roleHasCapability: vi.fn(),
  SITE_CAPABILITIES: [
    "network.users.manage",
    "network.plugins.manage",
    "network.rbac.manage",
    "network.settings.read",
    "network.settings.write",
    "network.site.manage",
    "network.site.delete",
    "network.themes.manage",
    "site.plugins.manage",
    "site.themes.manage",
    "site.datadomain.manage",
    "site.seo.manage",
    "site.menus.manage",
    "site.settings.read",
    "site.settings.write",
    "site.users.manage",
    "site.content.create",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.delete.own",
    "site.content.delete.any",
    "site.content.publish",
    "site.taxonomy.manage",
    "site.media.create",
    "site.media.edit.own",
    "site.media.edit.any",
    "site.media.delete.own",
    "site.media.delete.any",
    "site.analytics.read",
  ],
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      users: { findFirst: mocks.usersFindFirst },
      sites: {
        findFirst: mocks.sitesFindFirst,
        findMany: mocks.sitesFindMany,
      },
      domainPosts: { findFirst: mocks.domainPostsFindFirst },
    },
  },
}));

vi.mock("@/lib/site-user-tables", () => ({
  getSiteUserRole: mocks.getSiteUserRole,
}));

vi.mock("@/lib/rbac", () => ({
  isAdministrator: mocks.isAdministrator,
  roleHasCapability: mocks.roleHasCapability,
  SITE_CAPABILITIES: mocks.SITE_CAPABILITIES,
}));

import {
  canUserAccessSiteCapability,
  canUserManageNetworkCapability,
  canUserMutateDomainPost,
  getAuthorizedSiteForUser,
  isSuperAdminUser,
  userCan,
  user_can,
} from "@/lib/authorization";

describe("authorization helpers", () => {
  beforeEach(() => {
    mocks.usersFindFirst.mockReset();
    mocks.sitesFindFirst.mockReset();
    mocks.sitesFindMany.mockReset();
    mocks.domainPostsFindFirst.mockReset();
    mocks.getSiteUserRole.mockReset();
    mocks.isAdministrator.mockReset();
    mocks.roleHasCapability.mockReset();

    mocks.usersFindFirst.mockResolvedValue({ role: "editor" });
    mocks.isAdministrator.mockReturnValue(false);
    mocks.getSiteUserRole.mockResolvedValue("editor");
    mocks.roleHasCapability.mockResolvedValue(true);
  });

  it("treats users with network.rbac.manage as super admin", async () => {
    mocks.usersFindFirst.mockResolvedValue({ role: "network admin" });
    mocks.roleHasCapability.mockImplementation(async (_role: string, capability: string) => capability === "network.rbac.manage");

    await expect(isSuperAdminUser("user-1")).resolves.toBe(true);
  });

  it("denies site capability access without site role", async () => {
    mocks.getSiteUserRole.mockResolvedValue(null);
    mocks.roleHasCapability.mockResolvedValue(false);

    await expect(canUserAccessSiteCapability("user-1", "site-1", "site.settings.read")).resolves.toBe(false);
  });

  it("authorizes site through centralized capability check", async () => {
    mocks.sitesFindFirst.mockResolvedValue({ id: "site-1", name: "Main" });

    const site = await getAuthorizedSiteForUser("user-1", "site-1", "site.settings.read");
    expect(site).toEqual({ id: "site-1", name: "Main" });
  });

  it("checks network capability via global role matrix", async () => {
    mocks.usersFindFirst.mockResolvedValue({ role: "network admin" });
    const allowed = await canUserManageNetworkCapability("user-1", "network.plugins.manage");

    expect(allowed).toBe(true);
    expect(mocks.roleHasCapability).toHaveBeenCalledWith("network admin", "network.plugins.manage");
  });

  it("supports userCan/user_can centralized checks", async () => {
    mocks.usersFindFirst.mockResolvedValue({ role: "network admin" });
    const networkAllowed = await userCan("network.settings.write", "user-1");
    const siteAllowed = await user_can("site.settings.read", "user-1", { siteId: "site-1" });
    const deniedWithoutSite = await userCan("site.settings.read", "user-1");

    expect(networkAllowed).toBe(true);
    expect(siteAllowed).toBe(true);
    expect(deniedWithoutSite).toBe(false);
  });

  it("permits edit via content.edit.any even for non-owner", async () => {
    mocks.domainPostsFindFirst.mockResolvedValue({
      id: "post-1",
      siteId: "site-1",
      userId: "another-user",
      slug: "hello",
      published: true,
    });
    mocks.roleHasCapability.mockImplementation(async (_role: string, capability: string) => capability === "site.content.edit.any");

    const result = await canUserMutateDomainPost("user-1", "post-1", "edit");

    expect(result.allowed).toBe(true);
  });

  it("denies delete when only own capability is present for non-owner", async () => {
    mocks.domainPostsFindFirst.mockResolvedValue({
      id: "post-2",
      siteId: "site-1",
      userId: "owner-user",
      slug: "hello",
      published: true,
    });
    mocks.roleHasCapability.mockImplementation(async (_role: string, capability: string) => capability === "site.content.delete.own");

    const result = await canUserMutateDomainPost("user-1", "post-2", "delete");

    expect(result.allowed).toBe(false);
  });
});
