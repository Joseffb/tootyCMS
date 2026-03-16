import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parsePlaywrightProjectNames(output) {
  const names = [];
  const seen = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*\[([^\]]+)\]\s+›/);
    const name = match?.[1]?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function main(argv) {
  const result = spawnSync("pnpm", ["exec", "playwright", "test", "--list", ...argv], {
    encoding: "utf8",
    env: process.env,
  });

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    process.exit(result.status ?? 1);
  }

  const names = parsePlaywrightProjectNames(result.stdout || "");
  if (names.length === 0) {
    console.error("No Playwright projects matched the provided arguments.");
    process.exit(1);
  }

  process.stdout.write(`${names.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
