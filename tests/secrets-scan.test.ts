import { describe, expect, it } from "vitest";
import { scanTextForSecrets, shouldSkipFilePath } from "@/lib/secrets-scan";

describe("secrets scanner", () => {
  it("finds high-risk assignments", () => {
    const fakeToken = ["sk", "live", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
    const findings = scanTextForSecrets(
      "app/config.ts",
      `const API_KEY = "${fakeToken}";`,
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.rule).toBe("generic-secret-assignment");
  });

  it("ignores obvious example placeholders", () => {
    const findings = scanTextForSecrets(
      ".env.example",
      'API_KEY="your_api_key_here"',
    );
    expect(findings).toEqual([]);
  });

  it("skips binary/build paths", () => {
    expect(shouldSkipFilePath("node_modules/a.js")).toBe(true);
    expect(shouldSkipFilePath(".next/server/app.js")).toBe(true);
    expect(shouldSkipFilePath("public/icon.png")).toBe(true);
    expect(shouldSkipFilePath("src/app.ts")).toBe(false);
  });
});
