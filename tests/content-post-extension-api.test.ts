import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPluginOwnerForDataDomain: vi.fn(),
  getSiteDomainPostById: vi.fn(),
  listSiteDomainPosts: vi.fn(),
}));

vi.mock("@/lib/plugin-content-types", () => ({
  getPluginOwnerForDataDomain: mocks.getPluginOwnerForDataDomain,
}));

vi.mock("@/lib/site-domain-post-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/site-domain-post-store")>();
  return {
    ...actual,
    getSiteDomainPostById: mocks.getSiteDomainPostById,
    listSiteDomainPosts: mocks.listSiteDomainPosts,
  };
});

import { createPluginExtensionApi, createThemeExtensionApi } from "@/lib/extension-api";

describe("content post extension api", () => {
  afterEach(() => {
    mocks.getPluginOwnerForDataDomain.mockReset();
    mocks.getSiteDomainPostById.mockReset();
    mocks.listSiteDomainPosts.mockReset();
  });

  it("allows themes to read site content posts", async () => {
    mocks.getSiteDomainPostById.mockResolvedValue({
      id: "chapter-1",
      dataDomainKey: "story-chapter",
      title: "Chapter 1",
      description: "Desc",
      content: "Hello",
      slug: "chapter-1",
      image: "",
      layout: null,
      published: true,
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-10T01:00:00.000Z"),
    });

    const api = createThemeExtensionApi("theme-1");
    await expect(api.core.content.post.get("site-1", "story-chapter", "chapter-1")).resolves.toMatchObject({
      id: "chapter-1",
      dataDomainKey: "story-chapter",
      title: "Chapter 1",
      slug: "chapter-1",
      published: true,
    });
  });

  it("restricts plugins to reading their own plugin-owned content posts", async () => {
    mocks.getPluginOwnerForDataDomain.mockResolvedValue("tooty-story-teller");
    mocks.listSiteDomainPosts.mockResolvedValue([
      {
        id: "chapter-1",
        dataDomainKey: "story-chapter",
        title: "Chapter 1",
        description: "",
        content: "Hello",
        slug: "chapter-1",
        image: "",
        layout: null,
        published: true,
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T01:00:00.000Z"),
      },
    ]);

    const api = createPluginExtensionApi("tooty-story-teller", {
      siteId: "site-1",
      permissions: { contentMeta: { requested: true, suggestedRoles: ["administrator"] } },
    });
    await expect(api.core.content.post.list("site-1", "story-chapter", { includeContent: true })).resolves.toEqual([
      expect.objectContaining({
        id: "chapter-1",
        dataDomainKey: "story-chapter",
        content: "Hello",
      }),
    ]);
  });

  it("denies plugins from reading core-owned content posts through the plugin-only post api", async () => {
    mocks.getPluginOwnerForDataDomain.mockResolvedValue("");
    const api = createPluginExtensionApi("tooty-story-teller", {
      siteId: "site-1",
      permissions: { contentMeta: { requested: true, suggestedRoles: ["administrator"] } },
    });

    await expect(api.core.content.post.get("site-1", "post", "post-1")).rejects.toThrow(/own plugin-owned content/i);
  });
});
