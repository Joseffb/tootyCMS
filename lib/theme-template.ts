import nunjucks from "nunjucks/browser/nunjucks";
import { buildThemeSystemContext } from "@/lib/theme-system-context";

const env = new nunjucks.Environment(undefined, {
  autoescape: true,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

export function renderThemeTemplate(template: string, context: Record<string, unknown>) {
  const ctx = context as Record<string, unknown>;
  const system = buildThemeSystemContext(ctx);
  const payload: Record<string, unknown> = {
    ...system,
    system,
    ...context,
  };

  const headerRaw = typeof payload.theme_header === "string" ? payload.theme_header : "";
  const footerRaw = typeof payload.theme_footer === "string" ? payload.theme_footer : "";
  if (headerRaw) {
    payload.theme_header = env.renderString(headerRaw, payload);
  }
  if (footerRaw) {
    payload.theme_footer = env.renderString(footerRaw, payload);
  }

  return env.renderString(template, payload);
}
