import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildManagedTsconfig, prepareManagedTsconfig } from "../scripts/prepare-next-tsconfig.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("prepare next tsconfig", () => {
  it("adds exact dist includes and strips wildcard test dist entries", () => {
    const config = buildManagedTsconfig(
      {
        include: [
          "next-env.d.ts",
          "**/*.ts",
          ".next/types/**/*.ts",
          ".next/dev/types/**/*.ts",
          ".next-audit/types/**/*.ts",
          ".next-liveidle/dev/types/**/*.ts",
          ".next-test-*/types/**/*.ts",
          ".next-playwright-harness-*/dev/types/**/*.ts",
          ".next-vercel-dev/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      ".next-test-3123",
    );

    expect(config.include).toContain(".next-test-3123/types/**/*.ts");
    expect(config.include).toContain(".next-test-3123/dev/types/**/*.ts");
    expect(config.include).not.toContain(".next/types/**/*.ts");
    expect(config.include).not.toContain(".next/dev/types/**/*.ts");
    expect(config.include).not.toContain(".next-audit/types/**/*.ts");
    expect(config.include).not.toContain(".next-liveidle/dev/types/**/*.ts");
    expect(config.include).not.toContain(".next-test-*/types/**/*.ts");
    expect(config.include).not.toContain(".next-playwright-harness-*/dev/types/**/*.ts");
    expect(config.include).not.toContain(".next-vercel-dev/types/**/*.ts");
    expect(config.exclude).toContain(".next-test-*/**");
    expect(config.exclude).toContain(".next-playwright-harness-*/**");
    expect(config.exclude).toContain(".next-vercel-dev*/**");
  });

  it("restores the default next includes when no dist dir override is used", () => {
    const config = buildManagedTsconfig(
      {
        include: [
          "next-env.d.ts",
          "**/*.ts",
          ".next-vercel-dev/types/**/*.ts",
          ".next-audit/dev/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      "",
    );

    expect(config.include).toContain(".next/types/**/*.ts");
    expect(config.include).toContain(".next/dev/types/**/*.ts");
    expect(config.include).not.toContain(".next-vercel-dev/types/**/*.ts");
    expect(config.include).not.toContain(".next-audit/dev/types/**/*.ts");
  });

  it("rebases path aliases for generated configs outside repo root", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-next-tsconfig-"));
    tempDirs.push(tempDir);

    const sourceFile = path.join(tempDir, "tsconfig.source.json");
    const outputDir = path.join(tempDir, ".tmp");
    const outputFile = path.join(outputDir, "tsconfig.generated.json");

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify(
        {
          compilerOptions: {
            paths: {
              "@/*": ["./*"],
            },
          },
          include: ["**/*.ts"],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
    );

    prepareManagedTsconfig(outputFile, ".next-vercel-dev", sourceFile);

    const generated = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    expect(generated.compilerOptions.baseUrl).toBe("..");
    expect(generated.compilerOptions.paths["@/*"]).toEqual(["./*"]);
  });
});
