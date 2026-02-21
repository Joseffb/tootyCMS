import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPluginsWithStateMock } = vi.hoisted(() => ({
  listPluginsWithStateMock: vi.fn(),
}));

vi.mock("@/lib/plugins", () => ({
  getAvailablePlugins: vi.fn(async () => []),
  getEnabledPluginMenuItems: vi.fn(async () => []),
  getPluginById: vi.fn(async () => null),
  listPluginsWithState: listPluginsWithStateMock,
  pluginConfigKey: (pluginId: string) => `plugin_${pluginId}_config`,
  pluginEnabledKey: (pluginId: string) => `plugin_${pluginId}_enabled`,
}));

import { createKernelForRequest } from "@/lib/plugin-runtime";

describe("plugin runtime capability enforcement", () => {
  beforeEach(() => {
    listPluginsWithStateMock.mockReset();
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

  it("registers dashboard menu when adminExtensions is true", async () => {
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

    expect(dashboardItems).toEqual([
      {
        label: "Admin Plugin",
        href: "/app/plugins/admin-plugin",
        order: 90,
      },
    ]);
  });
});

