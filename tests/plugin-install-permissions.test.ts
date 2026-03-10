import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRbacRoles: vi.fn(),
  grantRoleCapabilities: vi.fn(async () => undefined),
}));

vi.mock("@/lib/rbac", () => ({
  listRbacRoles: mocks.listRbacRoles,
  grantRoleCapabilities: mocks.grantRoleCapabilities,
}));

import {
  applyPluginInstallPermissionGrants,
  buildPluginInstallPermissionPreview,
} from "@/lib/plugin-install-permissions";

describe("plugin install permissions", () => {
  beforeEach(() => {
    mocks.listRbacRoles.mockReset();
    mocks.grantRoleCapabilities.mockReset();
    mocks.listRbacRoles.mockResolvedValue([
      { role: "administrator", isSystem: true, capabilities: {} },
      { role: "editor", isSystem: true, capabilities: {} },
    ]);
  });

  it("derives only self-scoped plugin capabilities and existing role grants", async () => {
    const preview = await buildPluginInstallPermissionPreview({
      id: "tooty-comments",
      permissions: {
        contentMeta: {
          requested: true,
          suggestedRoles: ["administrator", "editor", "seo-manager"],
        },
      },
    });

    expect(preview).toEqual({
      requestedCapabilities: ["manage_plugin_tooty-comments_content_meta"],
      existingRoleGrants: [
        { role: "administrator", capabilities: ["manage_plugin_tooty-comments_content_meta"] },
        { role: "editor", capabilities: ["manage_plugin_tooty-comments_content_meta"] },
      ],
      ignoredSuggestedRoles: ["seo-manager"],
    });
  });

  it("applies only confirmed existing role grants", async () => {
    const preview = await applyPluginInstallPermissionGrants({
      id: "tooty-comments",
      permissions: {
        contentMeta: {
          requested: true,
          suggestedRoles: ["administrator", "seo-manager"],
        },
      },
    });

    expect(mocks.grantRoleCapabilities).toHaveBeenCalledTimes(1);
    expect(mocks.grantRoleCapabilities).toHaveBeenCalledWith("administrator", [
      "manage_plugin_tooty-comments_content_meta",
    ]);
    expect(preview.ignoredSuggestedRoles).toEqual(["seo-manager"]);
  });
});
