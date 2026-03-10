import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readSource(filePath: string) {
  return readFileSync(path.join(process.cwd(), filePath), "utf8");
}

describe("scheduler db retry contract", () => {
  it("retries scheduler table reads and writes on retryable lock errors", () => {
    const source = readSource("lib/scheduler.ts");

    expect(source).toContain('candidate?.code === "40P01" || candidate?.code === "55P03"');
    expect(source).toContain("async function withSchedulerDbRetry");
    expect(source).toContain("await withSchedulerDbRetry(() => db.execute(sql`");
    expect(source).toContain("const res = await withSchedulerDbRetry(() => db.execute(sql`SELECT * FROM ${table} WHERE id = ${id} LIMIT 1`));");
    expect(source).toContain("await withSchedulerDbRetry(() => db.execute(sql`DELETE FROM ${table} WHERE id = ${id}`));");
    expect(source).toContain("const res = await withSchedulerDbRetry(() => db.execute(sql`select pg_try_advisory_lock(hashtext(${lockKeyName()})) as acquired`));");
  });
});
