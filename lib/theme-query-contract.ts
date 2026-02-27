import type { ThemeContract } from "@/lib/extension-contracts";
import type { ThemeQueryRequest } from "@/lib/theme-query";

export function resolveThemeQueryRequests(theme: ThemeContract | null | undefined, routeKind: string): ThemeQueryRequest[] {
  if (!theme?.queries?.length) return [];
  const normalizedRoute = routeKind.trim().toLowerCase();

  return theme.queries
    .filter((query) => {
      const route = String(query.route || "").trim().toLowerCase();
      if (!route) return true;
      return route === normalizedRoute;
    })
    .map((query) => ({
      key: query.key,
      source: query.source,
      scope: query.scope || "site",
      params: query.params || {},
      requiresCapability: query.requiresCapability,
    }));
}
