import { getSession } from "@/lib/auth";
import { getThemeContextApi } from "@/lib/extension-api";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getThemeQueryRequestsForSite } from "@/lib/theme-runtime";

export type ThemeAuthSnapshot = {
  logged_in: boolean;
  user_id: string;
  display_name: string;
  username: string;
};

export type ThemeSlotMap = Record<string, string>;

type ThemeRenderContextOptions = {
  kernel?: Awaited<ReturnType<typeof createKernelForRequest>>;
  slotContext?: Record<string, unknown>;
};

function buildThemeAuthSnapshot(session: Awaited<ReturnType<typeof getSession>>): ThemeAuthSnapshot {
  const user = session?.user;
  const displayName = String(user?.displayName || "").trim();
  const username = String(user?.username || "").trim();
  const name = String(user?.name || "").trim();
  return {
    logged_in: Boolean(String(user?.id || "").trim()),
    user_id: String(user?.id || "").trim(),
    display_name: displayName || username || name,
    username,
  };
}

export function shouldResolveThemeQueries(templateSources: Array<string | undefined | null>) {
  const combined = templateSources
    .map((source) => String(source || ""))
    .join("\n")
    .toLowerCase();
  if (!combined) return false;
  return combined.includes("tooty.query") || combined.includes("tooty['query']") || combined.includes('tooty["query"]');
}

export async function getThemeRenderContext(
  siteId: string,
  routeKind: string,
  templateSources: Array<string | undefined | null> = [],
  options: ThemeRenderContextOptions = {},
) {
  const shouldResolveQueries = shouldResolveThemeQueries(templateSources);
  const [session, queryRequests, rawSlots] = await Promise.all([
    getSession(),
    shouldResolveQueries ? getThemeQueryRequestsForSite(siteId, routeKind) : Promise.resolve([]),
    resolveThemeSlots(siteId, routeKind, options),
  ]);
  const [tootyBase, auth] = await Promise.all([
    getThemeContextApi(siteId, queryRequests, { userId: session?.user?.id }),
    Promise.resolve(buildThemeAuthSnapshot(session)),
  ]);
  const slots: ThemeSlotMap = {};
  if (rawSlots && typeof rawSlots === "object") {
    for (const [key, value] of Object.entries(rawSlots as Record<string, unknown>)) {
      const normalizedKey = String(key || "").trim();
      const normalizedValue = typeof value === "string" ? value.trim() : "";
      if (normalizedKey && normalizedValue) {
        slots[normalizedKey] = normalizedValue;
      }
    }
  }
  return { tooty: { ...tootyBase, slots }, auth };
}

async function resolveThemeSlots(siteId: string, routeKind: string, options: ThemeRenderContextOptions) {
  const kernel = options.kernel || (await createKernelForRequest(siteId));
  return kernel.applyFilters("theme:slots", {}, {
    siteId,
    routeKind,
    ...(options.slotContext || {}),
  });
}
