import { describe, expect, it } from "vitest";

import { buildManagedTsconfig } from "../scripts/prepare-next-tsconfig.mjs";

describe("prepare next tsconfig", () => {
  it("adds exact dist includes and strips wildcard test dist entries", () => {
    const config = buildManagedTsconfig(
      {
        include: [
          "next-env.d.ts",
          "**/*.ts",
          ".next/types/**/*.ts",
          ".next-test-*/types/**/*.ts",
          ".next-playwright-harness-*/dev/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      ".next-test-3123",
    );

    expect(config.include).toContain(".next-test-3123/types/**/*.ts");
    expect(config.include).toContain(".next-test-3123/dev/types/**/*.ts");
    expect(config.include).not.toContain(".next-test-*/types/**/*.ts");
    expect(config.include).not.toContain(".next-playwright-harness-*/dev/types/**/*.ts");
    expect(config.exclude).toContain(".next-test-*/**");
    expect(config.exclude).toContain(".next-playwright-harness-*/**");
  });
});
