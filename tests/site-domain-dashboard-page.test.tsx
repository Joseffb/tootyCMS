// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteDomainDashboard from "@/app/app/(dashboard)/site/[id]/domain/page";
import { getAllDataDomains } from "@/lib/actions";

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

vi.mock("@/lib/cms-config", () => ({
  getSiteUrlSetting: vi.fn(async () => ({ value: "" })),
}));

vi.mock("@/lib/analytics-availability", () => ({
  hasGraphAnalyticsProvider: vi.fn(async () => false),
}));

vi.mock("@/lib/actions", () => ({
  getAllDataDomains: vi.fn(async () => [
    {
      id: 1,
      key: "post",
      label: "Posts",
      assigned: true,
      isActive: true,
      settings: { showInMenu: true },
    },
  ]),
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  listSiteDomainPosts: vi.fn(async () => [
    {
      id: "post-1",
      siteId: "site-1",
      dataDomainId: 1,
      dataDomainKey: "post",
      dataDomainLabel: "Posts",
      title: "Hello",
      description: "",
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

vi.mock("@/lib/dashboard-popularity", () => ({
  getApprovedCommentCountsBySite: vi.fn(async () => new Map()),
  getViewCountsByPost: vi.fn(async () => new Map()),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

describe("SiteDomainDashboard page", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads domain visibility without forcing physical table checks or usage counts", async () => {
    const ui = await SiteDomainDashboard({
      params: Promise.resolve({ id: "site-1" }),
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByRole("heading", { name: "Test Site Dashboard" })).toBeTruthy();
    expect(getAllDataDomains).toHaveBeenCalledWith("site-1", {
      ensurePhysicalTables: false,
      includeUsageCount: false,
    });
  });
});
