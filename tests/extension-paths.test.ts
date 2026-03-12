import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getPluginsDirs, getThemesDirs } from "@/lib/extension-paths";

const originalThemesPath = process.env.THEMES_PATH;
const originalPluginsPath = process.env.PLUGINS_PATH;

afterEach(() => {
  if (originalThemesPath === undefined) {
    delete process.env.THEMES_PATH;
  } else {
    process.env.THEMES_PATH = originalThemesPath;
  }
  if (originalPluginsPath === undefined) {
    delete process.env.PLUGINS_PATH;
  } else {
    process.env.PLUGINS_PATH = originalPluginsPath;
  }
});

describe("extension path parsing", () => {
  it("preserves configured theme path order across multiple directories", () => {
    process.env.THEMES_PATH = "themes,../tootyCMS-themes,../tootyCMS-custom-themes";

    expect(getThemesDirs()).toEqual([
      path.join(process.cwd(), "themes"),
      path.join(process.cwd(), "../tootyCMS-themes"),
      path.join(process.cwd(), "../tootyCMS-custom-themes"),
    ]);
  });

  it("uses default theme and plugin search roots when env is unset", () => {
    delete process.env.THEMES_PATH;
    delete process.env.PLUGINS_PATH;

    expect(getThemesDirs()).toEqual([
      path.join(process.cwd(), "themes"),
      path.join(process.cwd(), "../tootyCMS-themes"),
      path.join(process.cwd(), "../tootyCMS-custom-themes"),
    ]);
    expect(getPluginsDirs()).toEqual([
      path.join(process.cwd(), "plugins"),
      path.join(process.cwd(), "../tootyCMS-plugins"),
      path.join(process.cwd(), "../tootyCMS-custom-plugins"),
    ]);
  });
});
