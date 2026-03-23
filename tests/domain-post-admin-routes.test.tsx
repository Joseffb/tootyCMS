// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import DomainPostCard from "@/components/domain-post-card";
import DomainPostListTable from "@/components/domain-post-list-table";
import CreateDomainPostButton from "@/components/create-domain-post-button";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/components/blur-image", () => ({
  default: ({ alt, src, blurDataURL, placeholder, ...props }: any) => <img alt={alt} src={src} {...props} />,
}));

vi.mock("@/components/icons/loading-dots", () => ({
  default: () => <span>loading</span>,
}));

describe("domain post admin routes", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses canonical /app/site post edit hrefs", () => {
    render(
      <DomainPostCard
        siteId="site-1"
        domainKey="page"
        data={{
          id: "post-1",
          title: "About",
          description: "About page",
          slug: "about",
          image: null,
          imageBlurhash: null,
          published: true,
          site: {
            id: "site-1",
            subdomain: "main",
            customDomain: null,
            isPrimary: true,
          },
        }}
      />,
    );

    const editLink = screen
      .getAllByRole("link")
      .find((element) => element.getAttribute("href") === "/app/site/site-1/domain/page/item/post-1");

    expect(editLink).toBeTruthy();
  });

  it("uses canonical /app/site create hrefs", () => {
    render(<CreateDomainPostButton siteId="site-1" domainKey="page" domainLabel="Page" />);

    const link = screen.getByRole("link", { name: "Create New Page" });
    expect(link.getAttribute("href")).toBe("/app/site/site-1/domain/page/create");
  });

  it("uses canonical /app/site post edit hrefs in list view", () => {
    render(
      <DomainPostListTable
        siteId="site-1"
        domainKey="page"
        site={{
          id: "site-1",
          subdomain: "main",
          customDomain: null,
          isPrimary: true,
        }}
        rows={[
          {
            id: "post-1",
            title: "About",
            description: "About page",
            slug: "about",
            published: true,
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            updatedAt: new Date("2026-03-02T00:00:00.000Z"),
          },
        ]}
      />,
    );

    const editLink = screen.getByRole("link", { name: "Edit" });
    const viewLink = screen.getByRole("link", { name: "View" });

    expect(editLink.getAttribute("href")).toBe("/app/site/site-1/domain/page/item/post-1");
    expect(viewLink.getAttribute("href")).toContain("/page/about");
  });

  it("uses canonical /app/site list hrefs after delete", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/form/delete-domain-post-form.tsx"),
      "utf8",
    );

    expect(source).toContain("getDomainPostAdminListPath(siteId, domainKey)");
    expect(source).not.toContain("router.push(`/site/${siteId}/domain/${domainKey}`)");
  });
});
