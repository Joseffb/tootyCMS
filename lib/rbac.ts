export const USER_ROLES = ["administrator", "editor", "author", "subscriber"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function normalizeRole(role: unknown): string {
  return String(role || "").trim().toLowerCase();
}

export function isAdministrator(role: unknown): boolean {
  return normalizeRole(role) === "administrator";
}
