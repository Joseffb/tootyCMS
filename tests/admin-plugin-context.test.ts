import { describe, expect, it } from "vitest";
import { buildAdminPluginPageContext } from "@/lib/admin-plugin-context";

describe("admin plugin page context", () => {
  it("parses network theme settings path", () => {
    const page = buildAdminPluginPageContext("/settings/themes");
    expect(page.scope).toBe("network");
    expect(page.isSettingsPage).toBe(true);
    expect(page.isThemePage).toBe(true);
    expect(page.section).toBe("themes");
  });

  it("parses site theme settings path", () => {
    const page = buildAdminPluginPageContext("/site/site_1/settings/themes");
    expect(page.scope).toBe("site");
    expect(page.siteId).toBe("site_1");
    expect(page.isSettingsPage).toBe(true);
    expect(page.isThemePage).toBe(true);
  });

  it("parses app-prefixed site path", () => {
    const page = buildAdminPluginPageContext("/app/site/site_1/settings/themes");
    expect(page.scope).toBe("site");
    expect(page.siteId).toBe("site_1");
    expect(page.isSettingsPage).toBe(true);
    expect(page.isThemePage).toBe(true);
  });

  it("parses plugin page path", () => {
    const page = buildAdminPluginPageContext("/plugins/export-import");
    expect(page.scope).toBe("plugin");
    expect(page.pluginId).toBe("export-import");
    expect(page.isPluginPage).toBe(true);
  });

  it("parses app-prefixed plugin path", () => {
    const page = buildAdminPluginPageContext("/app/plugins/export-import");
    expect(page.scope).toBe("plugin");
    expect(page.pluginId).toBe("export-import");
    expect(page.isPluginPage).toBe(true);
  });
});
