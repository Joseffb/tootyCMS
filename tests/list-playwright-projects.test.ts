import { describe, expect, it } from "vitest";

import { parsePlaywrightProjectNames } from "../scripts/list-playwright-projects.mjs";

describe("parsePlaywrightProjectNames", () => {
  it("returns unique project names in listing order", () => {
    const output = `
Listing tests:
  [chromium] › assets.spec.ts:3:5 › icon renders
  [chromium] › home.spec.ts:4:5 › home renders
  [firefox] › assets.spec.ts:3:5 › icon renders
  [webkit] › home.spec.ts:4:5 › home renders
`;

    expect(parsePlaywrightProjectNames(output)).toEqual(["chromium", "firefox", "webkit"]);
  });

  it("ignores unrelated lines", () => {
    const output = `
Listing tests:
No tests found.
  something else
`;

    expect(parsePlaywrightProjectNames(output)).toEqual([]);
  });
});
