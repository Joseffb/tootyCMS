import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const envSnapshot = { ...process.env };
const tempDirs: string[] = [];

async function freshTraceModule(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, envSnapshot);
  Object.assign(process.env, env);
  return import("@/lib/debug");
}

afterEach(async () => {
  Object.assign(process.env, envSnapshot);
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("trace pipeline contract", () => {
  it("writes jsonl with structured level and redaction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tooty-trace-"));
    tempDirs.push(root);

    const mod = await freshTraceModule({
      DEBUG_MODE: "true",
      TRACE_LOG_DIR: root,
      TRACE_PROFILE: "dev",
      TRACE_RETENTION_DAYS: "7",
      TRACE_MAX_FILES: "30",
    });

    mod.trace("scheduler", "run failed", { apiToken: "abc123", reason: "oops" }, "error");
    await mod.__flushTraceForTests();

    const day = new Date().toISOString().slice(0, 10);
    const line = (await readFile(path.join(root, `${day}.jsonl`), "utf8")).trim().split("\n")[0];
    const parsed = JSON.parse(line);

    expect(parsed.scope).toBe("scheduler");
    expect(parsed.level).toBe("error");
    expect(parsed.tier).toBe("Dev");
    expect(parsed.payload.apiToken).toBe("***redacted***");
  });

  it("prunes stale trace files by retention and max files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tooty-trace-"));
    tempDirs.push(root);
    await mkdir(root, { recursive: true });

    await writeFile(path.join(root, "2000-01-01.jsonl"), "{}\n", "utf8");
    await writeFile(path.join(root, "2000-01-02.jsonl"), "{}\n", "utf8");
    await writeFile(path.join(root, "2000-01-03.jsonl"), "{}\n", "utf8");

    const mod = await freshTraceModule({
      DEBUG_MODE: "true",
      TRACE_LOG_DIR: root,
      TRACE_PROFILE: "dev",
      TRACE_RETENTION_DAYS: "1",
      TRACE_MAX_FILES: "1",
    });

    mod.trace("kernel", "prune check", undefined, "info");
    await mod.__flushTraceForTests();

    const today = `${new Date().toISOString().slice(0, 10)}.jsonl`;
    const fs = await import("node:fs/promises");
    const names = (await fs.readdir(root)).sort();
    expect(names.includes(today)).toBe(true);
    expect(names.length).toBe(1);
  });
});
