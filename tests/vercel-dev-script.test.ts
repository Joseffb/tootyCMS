import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const vercelDevScriptPath = path.join(process.cwd(), "scripts/vercel-dev.sh");

describe("vercel-dev wrapper", () => {
  it("starts from a clean local Vercel cache and passes CLI args through", () => {
    const source = readFileSync(vercelDevScriptPath, "utf8");

    expect(source).toContain('VERCEL_CACHE_DIR="${REPO_ROOT}/.vercel/cache"');
    expect(source).toContain('rm -rf "${REPO_ROOT:?}/${DIST_DIR}"');
    expect(source).toContain('rm -rf "${VERCEL_CACHE_DIR}"');
    expect(source).toContain('exec vercel dev "$@"');
  });

  it("fails closed when any repo-local next/vercel dev process is already running", () => {
    const source = readFileSync(vercelDevScriptPath, "utf8");

    expect(source).toContain('find_repo_dev_seed_pids()');
    expect(source).toContain('ALLOW_PARALLEL_VERCEL_DEV');
    expect(source).toContain("repo-local Next/Vercel dev process(es) are already running");
    expect(source).toContain("Running multiple local dev servers for the same repo can revive stale route bundles");
  });
});
