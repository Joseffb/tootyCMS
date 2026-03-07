import { randomUUID } from "node:crypto";

function normalizeProjectName(projectName: string) {
  return String(projectName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "browser";
}

export function getProjectToken(projectName: string, length = 6) {
  return normalizeProjectName(projectName).replace(/-/g, "").slice(0, length) || "browser";
}

export function buildProjectRunId(base: string, projectName: string) {
  const normalizedBase = String(base || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalizedBase}-${getProjectToken(projectName)}-${randomUUID()}`;
}
