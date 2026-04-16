// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DomainPosts from "@/components/domain-posts";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/components/blur-image", () => ({
  default: ({ alt, src, blurDataURL: _blurDataURL, placeholder: _placeholder, ...props }: any) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

vi.mock("@/lib/actions", () => ({
  getSiteDataDomainByKey: vi.fn(async () => ({
    id: 1,
    key: "post",
    label: "Post",
  })),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: {
        findFirst: vi.fn(async () => ({
          id: "site-1",
          subdomain: "test-site",
          customDomain: "",
          isPrimary: false,
        })),
      },
    },
  },
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  listSiteDomainPosts: vi.fn(async () => [
    {
      id: "post-1",
      siteId: "site-1",
      dataDomainId: 1,
      dataDomainKey: "post",
      dataDomainLabel: "Post",
      title: "Hello",
      description: "Welcome entry",
      content: "",
      password: "",
      usePassword: false,
      layout: null,
      slug: "hello",
      image: "",
      imageBlurhash: "",
      published: true,
      userId: "user-1",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    },
  ]),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("DomainPosts", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the existing card grid by default", async () => {
    render(await DomainPosts({ siteId: "site-1", domainKey: "post" }));

    expect(screen.getByRole("img", { name: "Hello" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
  });

  it("renders a structured table in list view", async () => {
    render(await DomainPosts({ siteId: "site-1", domainKey: "post", view: "list" }));

    expect(screen.getByRole("columnheader", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/app/site/site-1/domain/post/item/post-1");
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toContain("/post/hello");
  });
});
