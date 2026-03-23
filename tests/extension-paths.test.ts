import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPluginsDirs,
  getThemesDirs,
  resolveExtensionPathFromBases,
} from "@/lib/extension-paths";

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
  it("prefers an existing later base when a worktree-relative candidate is missing", () => {
    const bases = [
      "/tmp/codex-worktree/tooty-cms",
      "/Users/joseffbetancourt/PhpstormProjects/tooty-cms",
    ];
    const primaryRepoPluginRoot = path.resolve(bases[1], "../tootyCMS-plugins");

    expect(
      resolveExtensionPathFromBases("../tootyCMS-plugins", bases, (candidate) => {
        return candidate === primaryRepoPluginRoot;
      }),
    ).toBe(primaryRepoPluginRoot);
  });

  it("falls back to the first base when no relative candidate exists yet", () => {
    const bases = ["/tmp/codex-worktree/tooty-cms", "/Users/joseffbetancourt/PhpstormProjects/tooty-cms"];

    expect(resolveExtensionPathFromBases("../tootyCMS-plugins", bases, () => false)).toBe(
      path.resolve(bases[0], "../tootyCMS-plugins"),
    );
  });

  it("preserves configured theme path order across multiple directories", () => {
    process.env.THEMES_PATH = "../tootyCMS-custom-themes,themes,../tootyCMS-themes";

    expect(getThemesDirs()).toHaveLength(3);
    expect(getThemesDirs()[0]).toMatch(/tootyCMS-custom-themes$/);
    expect(getThemesDirs()[1]).toBe(path.join(process.cwd(), "themes"));
    expect(getThemesDirs()[2]).toMatch(/tootyCMS-themes$/);
  });

  it("uses default theme and plugin search roots when env is unset", () => {
    delete process.env.THEMES_PATH;
    delete process.env.PLUGINS_PATH;

    expect(getThemesDirs()).toHaveLength(3);
    expect(getThemesDirs()[0]).toBe(path.join(process.cwd(), "themes"));
    expect(getThemesDirs()[1]).toMatch(/tootyCMS-themes$/);
    expect(getThemesDirs()[2]).toMatch(/tootyCMS-custom-themes$/);

    expect(getPluginsDirs()).toHaveLength(3);
    expect(getPluginsDirs()[0]).toBe(path.join(process.cwd(), "plugins"));
    expect(getPluginsDirs()[1]).toMatch(/tootyCMS-plugins$/);
    expect(getPluginsDirs()[2]).toMatch(/tootyCMS-custom-plugins$/);
  });
});
