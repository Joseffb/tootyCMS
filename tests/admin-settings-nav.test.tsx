// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GlobalSettingsNav from "@/app/app/(dashboard)/settings/nav";
import SiteSettingsNav from "@/app/app/(dashboard)/site/[id]/settings/nav";

const mocks = vi.hoisted(() => ({
  selectedSegment: null as string | null,
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => mocks.selectedSegment,
}));

describe("admin settings nav components", () => {
  beforeEach(() => {
    mocks.selectedSegment = null;
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the merged single-site settings nav from server adminMode", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        siteCount: 2,
        adminMode: "single-site",
        mainSiteId: "site-1",
        canManageNetworkSettings: true,
        canManageNetworkPlugins: true,
      }),
    });

    render(<GlobalSettingsNav />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "User Roles" })).toBeTruthy();
    });

    expect(screen.queryByRole("link", { name: "Sites" })).toBeNull();
    expect(screen.getByRole("link", { name: "Themes" }).getAttribute("href")).toBe("/app/site/site-1/settings/themes");
    expect(screen.getByRole("link", { name: "Migrations" }).getAttribute("href")).toBe("/app/site/site-1/settings/database");
  });

  it("renders the multi-site network settings nav without site settings items", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        siteCount: 1,
        adminMode: "multi-site",
        mainSiteId: "site-1",
        canManageNetworkSettings: true,
        canManageNetworkPlugins: true,
      }),
    });

    render(<GlobalSettingsNav />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Sites" })).toBeTruthy();
    });

    expect(screen.getByRole("link", { name: "Reading" }).getAttribute("href")).toBe("/app/settings/reading");
    expect(screen.queryByRole("link", { name: "General" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Comments" })).toBeNull();
  });

  it("renders merged site settings from server adminMode instead of siteCount", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        siteCount: 2,
        adminMode: "single-site",
        canManageNetworkSettings: true,
      }),
    });

    render(<SiteSettingsNav siteId="site-1" />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "User Roles" })).toBeTruthy();
    });

    expect(screen.getByRole("link", { name: "Schedules" }).getAttribute("href")).toBe("/app/site/site-1/settings/schedules");
    expect(screen.getByRole("link", { name: "Migrations" }).getAttribute("href")).toBe("/app/site/site-1/settings/database");
  });

  it("keeps multi-site site settings free of network-only items even if siteCount is one", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        siteCount: 1,
        adminMode: "multi-site",
        canManageNetworkSettings: true,
      }),
    });

    render(<SiteSettingsNav siteId="site-1" />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Themes" })).toBeTruthy();
    });

    expect(screen.queryByRole("link", { name: "User Roles" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Schedules" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Migrations" })).toBeNull();
  });
});
