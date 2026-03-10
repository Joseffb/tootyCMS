import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPluginOwnerForDataDomain: vi.fn(),
  canUserManagePluginContentMeta: vi.fn(),
  getSiteDomainPostById: vi.fn(),
  listSiteDomainPostMeta: vi.fn(),
  upsertSiteDomainPostMeta: vi.fn(),
  deleteSiteDomainPostMeta: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/plugin-content-types", () => ({
  getPluginOwnerForDataDomain: mocks.getPluginOwnerForDataDomain,
}));

vi.mock("@/lib/authorization", () => ({
  canUserManagePluginContentMeta: mocks.canUserManagePluginContentMeta,
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  getSiteDomainPostById: mocks.getSiteDomainPostById,
  listSiteDomainPostMeta: mocks.listSiteDomainPostMeta,
  upsertSiteDomainPostMeta: mocks.upsertSiteDomainPostMeta,
  deleteSiteDomainPostMeta: mocks.deleteSiteDomainPostMeta,
}));

import { createPluginExtensionApi, createThemeExtensionApi } from "@/lib/extension-api";

describe("content meta extension api", () => {
  afterEach(() => {
    mocks.getSession.mockReset();
    mocks.getPluginOwnerForDataDomain.mockReset();
    mocks.canUserManagePluginContentMeta.mockReset();
    mocks.getSiteDomainPostById.mockReset();
    mocks.listSiteDomainPostMeta.mockReset();
    mocks.upsertSiteDomainPostMeta.mockReset();
    mocks.deleteSiteDomainPostMeta.mockReset();
  });

  it("allows themes to read content meta while filtering by key", async () => {
    mocks.getSiteDomainPostById.mockResolvedValue({ id: "post-1" });
    mocks.listSiteDomainPostMeta.mockResolvedValue([
      { key: "subtitle", value: "Hello" },
      { key: "_view_count", value: "7" },
    ]);
    const api = createThemeExtensionApi("theme-1");

    await expect(
      api.core.content.meta.read("site-1", "page", "post-1", "subtitle"),
    ).resolves.toEqual([{ key: "subtitle", value: "Hello" }]);
  });

  it("exposes only read on theme content meta api", async () => {
    const api = createThemeExtensionApi("theme-1");

    expect("set" in api.core.content.meta).toBe(false);
    expect("delete" in api.core.content.meta).toBe(false);
  });

  it("denies plugin content meta access without declared permission", async () => {
    const api = createPluginExtensionApi("tooty-carousels", {
      siteId: "site-1",
    });

    await expect(api.core.content.meta.read("site-1", "carousel", "post-1")).rejects.toThrow(
      /declaring permissions\.contentMeta\.requested/i,
    );
  });

  it("denies plugin content meta access for core-owned content", async () => {
    mocks.getPluginOwnerForDataDomain.mockResolvedValue("");
    const api = createPluginExtensionApi("tooty-carousels", {
      siteId: "site-1",
      permissions: { contentMeta: { requested: true, suggestedRoles: ["administrator"] } },
    });

    await expect(api.core.content.meta.read("site-1", "page", "post-1")).rejects.toThrow(/own plugin-owned content/i);
  });

  it("denies plugin content meta mutation without RBAC capability", async () => {
    mocks.getPluginOwnerForDataDomain.mockResolvedValue("tooty-carousels");
    mocks.getSiteDomainPostById.mockResolvedValue({ id: "post-1" });
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.canUserManagePluginContentMeta.mockResolvedValue(false);
    const api = createPluginExtensionApi("tooty-carousels", {
      siteId: "site-1",
      permissions: { contentMeta: { requested: true, suggestedRoles: ["administrator"] } },
    });

    await expect(api.core.content.meta.set("site-1", "carousel", "post-1", "caption", "Hello")).rejects.toThrow(
      /manage_plugin_content_meta/i,
    );
  });

  it("allows plugin-owned content meta CRUD with manifest permission and RBAC capability", async () => {
    mocks.getPluginOwnerForDataDomain.mockResolvedValue("tooty-carousels");
    mocks.getSiteDomainPostById.mockResolvedValue({ id: "post-1" });
    mocks.listSiteDomainPostMeta.mockResolvedValue([{ key: "caption", value: "Hello" }]);
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.canUserManagePluginContentMeta.mockResolvedValue(true);
    const api = createPluginExtensionApi("tooty-carousels", {
      siteId: "site-1",
      permissions: { contentMeta: { requested: true, suggestedRoles: ["administrator"] } },
    });

    await expect(api.core.content.meta.read("site-1", "carousel", "post-1")).resolves.toEqual([
      { key: "caption", value: "Hello" },
    ]);
    await expect(api.core.content.meta.set("site-1", "carousel", "post-1", "caption", "Updated")).resolves.toEqual({
      ok: true,
    });
    await expect(api.core.content.meta.delete("site-1", "carousel", "post-1", "caption")).resolves.toEqual({
      ok: true,
    });

    expect(mocks.upsertSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "carousel",
      postId: "post-1",
      key: "caption",
      value: "Updated",
    });
    expect(mocks.deleteSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "carousel",
      postId: "post-1",
      key: "caption",
    });
  });
});
