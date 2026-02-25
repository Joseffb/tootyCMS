export const CORE_VERSION = "0.4.0";
export const CORE_VERSION_SERIES = "0.4.x";

type SemverTuple = [number, number, number];

function parseSemverTuple(raw: string): SemverTuple | null {
  const normalized = raw.trim().toLowerCase().replace(/^v/, "");
  const parts = normalized.split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((part) => Number.isNaN(part) || part < 0)) return null;
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

function parseMinimumFloor(raw: string): SemverTuple | null {
  const normalized = raw.trim().toLowerCase().replace(/^v/, "");
  if (!normalized) return null;
  const parts = normalized.split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const floor: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const part = parts[i];
    if (part === undefined || part === "" || part === "x" || part === "*") {
      floor.push(0);
      continue;
    }
    const parsed = Number.parseInt(part, 10);
    if (Number.isNaN(parsed) || parsed < 0) return null;
    floor.push(parsed);
  }
  return [floor[0], floor[1], floor[2]];
}

function compareSemver(a: SemverTuple, b: SemverTuple) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

export function isCoreVersionCompatible(minCoreVersion?: string) {
  const raw = String(minCoreVersion ?? "").trim();
  if (!raw) return true;
  const current = parseSemverTuple(CORE_VERSION);
  const floor = parseMinimumFloor(raw);
  if (!current || !floor) return false;
  return compareSemver(current, floor) >= 0;
}
