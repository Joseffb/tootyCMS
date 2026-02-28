import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getThemesDirs } from "@/lib/extension-paths";

const originalThemesPath = process.env.THEMES_PATH;

afterEach(() => {
  if (originalThemesPath === undefined) {
    delete process.env.THEMES_PATH;
  } else {
    process.env.THEMES_PATH = originalThemesPath;
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
});
