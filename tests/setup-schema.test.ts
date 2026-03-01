import { describe, expect, it } from "vitest";
import {
  ALL_EXPECTED_SETUP_TABLE_SUFFIXES,
  REQUIRED_SETUP_TABLE_SUFFIXES,
} from "@/lib/setup-schema";

describe("setup schema table expectations", () => {
  it("checks the live system settings table instead of the removed cms settings name", () => {
    expect(REQUIRED_SETUP_TABLE_SUFFIXES).toContain("system_settings");
    expect(ALL_EXPECTED_SETUP_TABLE_SUFFIXES).toContain("system_settings");
    expect(REQUIRED_SETUP_TABLE_SUFFIXES).not.toContain("cms_settings");
    expect(ALL_EXPECTED_SETUP_TABLE_SUFFIXES).not.toContain("cms_settings");
  });

  it("includes every required table in the full expected table list", () => {
    for (const table of REQUIRED_SETUP_TABLE_SUFFIXES) {
      expect(ALL_EXPECTED_SETUP_TABLE_SUFFIXES).toContain(table);
    }
  });
});
