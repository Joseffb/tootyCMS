import nunjucks from "nunjucks";
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

  return env.renderString(template, {
    ...system,
    system,
    ...context,
  });
}
