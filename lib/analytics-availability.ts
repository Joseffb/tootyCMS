import { createKernelForRequest } from "@/lib/plugin-runtime";
import { listPluginsWithSiteState } from "@/lib/plugins";

export async function hasEnabledSiteAnalyticsPlugin(siteId: string) {
  if (!siteId) return false;
  const pluginStates = await listPluginsWithSiteState(siteId);
  return pluginStates.some((plugin: any) => {
    const isAnalytics = String(plugin?.id || "").startsWith("analytics-");
    return isAnalytics && Boolean(plugin?.enabled && plugin?.siteEnabled);
  });
}

export async function hasGraphAnalyticsProvider(siteId: string) {
  if (!siteId) return false;
  const pluginEnabled = await hasEnabledSiteAnalyticsPlugin(siteId);
  if (!pluginEnabled) return false;

  const kernel = await createKernelForRequest(siteId);
  const request = new Request("http://localhost/api/analytics/query?name=visitors_per_day", {
    method: "GET",
  });

  const response = await kernel.applyFilters<Response | null>(
    "domain:query",
    null,
    {
      request,
      name: "visitors_per_day",
      params: { name: "visitors_per_day", siteId },
    },
  );

  if (!response) return false;
  if (response.status < 200 || response.status >= 300) return false;

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return false;

  try {
    const payload = JSON.parse(await response.text());
    return Array.isArray(payload?.data);
  } catch {
    return false;
  }
}
