import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === ".next" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function isClientComponent(filePath: string) {
  const content = readFileSync(filePath, "utf8");
  const header = content.split(/\r?\n/).slice(0, 6).join("\n");
  return /^\s*["']use client["'];?/m.test(header);
}

function parseImports(content: string): string[] {
  const imports: string[] = [];
  const re = /^\s*import(?:["'\s\w{},*]+from\s*)?["']([^"']+)["'];?/gm;
  for (const match of content.matchAll(re)) {
    if (match[1]) imports.push(match[1]);
  }
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/gm;
  for (const match of content.matchAll(dynamicRe)) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

function resolveProjectImport(root: string, fromFile: string, specifier: string): string | null {
  const tryTargets: string[] = [];
  if (specifier.startsWith("@/")) {
    const base = path.join(root, specifier.slice(2));
    tryTargets.push(base);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    tryTargets.push(base);
  } else {
    return null;
  }

  for (const target of tryTargets) {
    const candidates = [
      target,
      `${target}.ts`,
      `${target}.tsx`,
      `${target}.js`,
      `${target}.mjs`,
      path.join(target, "index.ts"),
      path.join(target, "index.tsx"),
      path.join(target, "index.js"),
      path.join(target, "index.mjs"),
    ];
    for (const candidate of candidates) {
      try {
        const stat = statSync(candidate);
        if (stat.isFile()) return path.normalize(candidate);
      } catch {
        // no-op
      }
    }
  }
  return null;
}

function isServerOnlyLibModule(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const exact = new Set([
    "lib/auth.ts",
    "lib/authorization.ts",
    "lib/rbac.ts",
    "lib/scheduler.ts",
    "lib/communications.ts",
    "lib/webcallbacks.ts",
    "lib/domain-dispatch.ts",
    "lib/domain-events.ts",
    "lib/domain-queue.ts",
    "lib/plugin-runtime.ts",
  ]);
  if (exact.has(normalized)) return true;
  return false;
}

function findCycleFromNode(
  start: string,
  graph: Map<string, Set<string>>,
  stack: string[],
  onPath: Set<string>,
  visited: Set<string>,
): string[] | null {
  stack.push(start);
  onPath.add(start);
  visited.add(start);

  for (const next of graph.get(start) ?? []) {
    if (!onPath.has(next) && !visited.has(next)) {
      const found = findCycleFromNode(next, graph, stack, onPath, visited);
      if (found) return found;
      continue;
    }
    if (onPath.has(next)) {
      const cycleStart = stack.indexOf(next);
      return [...stack.slice(cycleStart), next];
    }
  }

  onPath.delete(start);
  stack.pop();
  return null;
}

describe("server boundaries", () => {
  it("blocks client components from importing server-only runtime modules", () => {
    const root = process.cwd();
    const targets = [path.join(root, "app"), path.join(root, "components")];
    const offenders: Array<{ file: string; import: string; resolved: string }> = [];

    for (const target of targets) {
      for (const file of walkFiles(target)) {
        if (!isClientComponent(file)) continue;
        const content = readFileSync(file, "utf8");
        for (const specifier of parseImports(content)) {
          const resolved = resolveProjectImport(root, file, specifier);
          if (!resolved) continue;
          const relative = path.relative(root, resolved);
          if (isServerOnlyLibModule(relative)) {
            offenders.push({
              file: path.relative(root, file),
              import: specifier,
              resolved: relative,
            });
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps core server subsystem imports acyclic", () => {
    const root = process.cwd();
    const nodes = [
      "lib/auth.ts",
      "lib/authorization.ts",
      "lib/rbac.ts",
      "lib/scheduler.ts",
      "lib/communications.ts",
      "lib/webcallbacks.ts",
      "lib/domain-dispatch.ts",
      "lib/domain-events.ts",
      "lib/domain-queue.ts",
      "lib/kernel.ts",
      "lib/plugin-runtime.ts",
    ];
    const nodeSet = new Set(nodes);
    const graph = new Map<string, Set<string>>();
    for (const node of nodes) graph.set(node, new Set<string>());

    for (const node of nodes) {
      const absolute = path.join(root, node);
      const content = readFileSync(absolute, "utf8");
      for (const specifier of parseImports(content)) {
        const resolved = resolveProjectImport(root, absolute, specifier);
        if (!resolved) continue;
        const relative = path.relative(root, resolved).replace(/\\/g, "/");
        if (nodeSet.has(relative)) {
          graph.get(node)?.add(relative);
        }
      }
    }

    const visited = new Set<string>();
    let cycle: string[] | null = null;
    for (const node of nodes) {
      if (visited.has(node)) continue;
      cycle = findCycleFromNode(node, graph, [], new Set<string>(), visited);
      if (cycle) break;
    }

    expect(cycle).toBeNull();
  });
});
