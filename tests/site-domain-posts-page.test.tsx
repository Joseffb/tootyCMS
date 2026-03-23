// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SiteDomainPostsPage from "@/app/app/(dashboard)/site/[id]/domain/[domainKey]/page";

const cookieGetMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/script", () => ({
  default: ({ children, id }: any) => <script data-testid={id}>{children}</script>,
}));

vi.mock("@/components/domain-posts", () => ({
  default: ({ view }: any) => <div data-testid="domain-posts-view">{view}</div>,
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

vi.mock("@/lib/admin-site-selection", () => ({
  resolveAuthorizedSiteForAnyCapability: vi.fn(async () => ({
    site: {
      id: "site-1",
      name: "Test Site",
      subdomain: "test-site",
      customDomain: "",
      isPrimary: false,
    },
  })),
}));

vi.mock("@/lib/actions", () => ({
  getSiteDataDomainByKey: vi.fn(async () => ({
    id: 1,
    key: "post",
    label: "Post",
  })),
}));

vi.mock("@/lib/cms-config", () => ({
  getSiteUrlSetting: vi.fn(async () => ({ value: "" })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGetMock,
  })),
}));

describe("SiteDomainPosts page", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
    cookieGetMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a top-right cards/list toggle and defaults to cards view", async () => {
    const ui = await SiteDomainPostsPage({
      params: Promise.resolve({ id: "site-1", domainKey: "post" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    const cardsLink = screen.getByRole("link", { name: "Cards view" });
    const listLink = screen.getByRole("link", { name: "List view" });

    expect(cardsLink.getAttribute("href")).toBe("/app/site/site-1/domain/post");
    expect(cardsLink.getAttribute("aria-current")).toBe("page");
    expect(listLink.getAttribute("href")).toBe("/app/site/site-1/domain/post?view=list");
    expect(screen.getByTestId("domain-posts-view").textContent).toBe("cards");
    expect(screen.getByTestId("domain-post-view-state").textContent).toContain("tooty_domain_posts_view=cards");
  });

  it("renders the structured list view when requested", async () => {
    const ui = await SiteDomainPostsPage({
      params: Promise.resolve({ id: "site-1", domainKey: "post" }),
      searchParams: Promise.resolve({ view: "list" }),
    });

    render(ui);

    expect(screen.getByRole("link", { name: "List view" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("domain-posts-view").textContent).toBe("list");
    expect(screen.getByTestId("domain-post-view-state").textContent).toContain("tooty_domain_posts_view=list");
  });

  it("prefers the remembered cookie view when the query param is absent", async () => {
    cookieGetMock.mockImplementation((key: string) =>
      key === "tooty_domain_posts_view" ? { value: "list" } : undefined,
    );

    const ui = await SiteDomainPostsPage({
      params: Promise.resolve({ id: "site-1", domainKey: "post" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByRole("link", { name: "List view" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("domain-posts-view").textContent).toBe("list");
  });
});
