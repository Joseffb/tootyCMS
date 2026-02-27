import { getSession } from "@/lib/auth";
import { getThemeContextApi } from "@/lib/extension-api";
import { getThemeQueryRequestsForSite } from "@/lib/theme-runtime";

export type ThemeAuthSnapshot = {
  logged_in: boolean;
  user_id: string;
  display_name: string;
  username: string;
  role: string;
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
    role: String(user?.role || "").trim(),
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
) {
  const shouldResolveQueries = shouldResolveThemeQueries(templateSources);
  const [session, queryRequests] = await Promise.all([
    getSession(),
    shouldResolveQueries ? getThemeQueryRequestsForSite(siteId, routeKind) : Promise.resolve([]),
  ]);
  const [tooty, auth] = await Promise.all([
    getThemeContextApi(siteId, queryRequests, { userId: session?.user?.id }),
    Promise.resolve(buildThemeAuthSnapshot(session)),
  ]);
  return { tooty, auth };
}
