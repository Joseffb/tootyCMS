export const COMPAT_MODE_ENV_KEY = "CMS_COMPAT_MODE";

export function isCompatModeEnabled() {
  const raw = String(process.env[COMPAT_MODE_ENV_KEY] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "enabled";
}

export function isNoCompatModeEnabled() {
  return !isCompatModeEnabled();
}

export function assertCompatMode(feature: string) {
  if (isCompatModeEnabled()) return;
  throw new Error(`[compat-disabled] ${feature} is disabled before v1/public RC.`);
}
