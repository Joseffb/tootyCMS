import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPluginsWithStateMock, listPluginsWithSiteStateMock } = vi.hoisted(() => ({
  listPluginsWithStateMock: vi.fn(),
  listPluginsWithSiteStateMock: vi.fn(),
}));

vi.mock("@/lib/plugins", () => ({
  getAvailablePlugins: vi.fn(async () => []),
  getEnabledPluginMenuItems: vi.fn(async () => []),
  getPluginById: vi.fn(async () => null),
  getPluginEntryPath: vi.fn(async () => "/nonexistent/plugin/index.mjs"),
  listPluginsWithSiteState: listPluginsWithSiteStateMock,
  listPluginsWithState: listPluginsWithStateMock,
  pluginConfigKey: (pluginId: string) => `plugin_${pluginId}_config`,
  pluginEnabledKey: (pluginId: string) => `plugin_${pluginId}_enabled`,
}));

import { createKernelForRequest, getDashboardPluginMenuItems } from "@/lib/plugin-runtime";

describe("plugin runtime capability enforcement", () => {
  beforeEach(() => {
    listPluginsWithStateMock.mockReset();
    listPluginsWithSiteStateMock.mockReset();
  });

  it("skips dashboard menu registration when adminExtensions is false", async () => {
    listPluginsWithStateMock.mockResolvedValue([
      {
        kind: "plugin",
        id: "no-admin-plugin",
        name: "No Admin Plugin",
        enabled: true,
        config: {},
        capabilities: {
          hooks: true,
          adminExtensions: false,
          contentTypes: false,
          serverHandlers: false,
        },
        menu: {
          label: "No Admin Plugin",
          path: "/app/plugins/no-admin-plugin",
        },
      },
    ]);

    const kernel = await createKernelForRequest();
    const dashboardItems = kernel.getMenuItems("dashboard");

    expect(dashboardItems).toEqual([]);
  });

  it("does not register a root dashboard menu for settings-placement plugins", async () => {
    listPluginsWithStateMock.mockResolvedValue([
      {
        kind: "plugin",
        id: "admin-plugin",
        name: "Admin Plugin",
        enabled: true,
        config: {},
        capabilities: {
          hooks: true,
          adminExtensions: true,
          contentTypes: false,
          serverHandlers: false,
        },
        menu: {
          label: "Admin Plugin",
          path: "/app/plugins/admin-plugin",
        },
      },
    ]);

    const kernel = await createKernelForRequest();
    const dashboardItems = kernel.getMenuItems("dashboard");

    expect(dashboardItems).toEqual([]);
  });

  it("registers root dashboard menu when placement is root", async () => {
    listPluginsWithStateMock.mockResolvedValue([
      {
        kind: "plugin",
        id: "root-plugin",
        name: "Root Plugin",
        enabled: true,
        config: {},
        menuPlacement: "root",
        capabilities: {
          hooks: true,
          adminExtensions: true,
          contentTypes: false,
          serverHandlers: false,
        },
        menu: {
          label: "Root Plugin",
          path: "/app/plugins/root-plugin",
          order: 35,
        },
      },
    ]);

    const kernel = await createKernelForRequest();
    const dashboardItems = kernel.getMenuItems("dashboard");

    expect(dashboardItems).toEqual([
      {
        label: "Root Plugin",
        href: "/app/plugins/root-plugin",
        order: 35,
      },
    ]);
  });

  it("returns separate root and settings dashboard items for both-placement plugins", async () => {
    listPluginsWithSiteStateMock.mockResolvedValue([
      {
        kind: "plugin",
        id: "suite-plugin",
        name: "Suite Plugin",
        scope: "site",
        enabled: true,
        config: {},
        menuPlacement: "both",
        capabilities: {
          hooks: true,
          adminExtensions: true,
          contentTypes: false,
          serverHandlers: false,
        },
        menu: {
          label: "Suite",
          path: "/app/plugins/suite-plugin",
          order: 40,
        },
        settingsMenu: {
          label: "Suite Settings",
          path: "/app/plugins/suite-plugin/settings",
          order: 50,
        },
      },
    ]);

    const items = await getDashboardPluginMenuItems("site-1");

    expect(items).toEqual([
      {
        pluginId: "suite-plugin",
        placement: "root",
        label: "Suite",
        href: "/app/plugins/suite-plugin?siteId=site-1",
        order: 40,
      },
      {
        pluginId: "suite-plugin",
        placement: "settings",
        label: "Suite Settings",
        href: "/app/plugins/suite-plugin/settings?siteId=site-1",
        order: 50,
      },
    ]);
  });

  it("registers the built-in AI providers on every request kernel", async () => {
    listPluginsWithStateMock.mockResolvedValue([]);

    const kernel = await createKernelForRequest();

    expect(kernel.getAllAiProviders().map((provider) => provider.id).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });
});
