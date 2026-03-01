function normalizeSegment(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

export function getAdminPathAlias(value?: string) {
  const configured = normalizeSegment(value || process.env.ADMIN_PATH || "");
  return configured || "cp";
}
