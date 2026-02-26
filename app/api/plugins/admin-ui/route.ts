import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { listPluginsWithSiteState, listPluginsWithState } from "@/lib/plugins";
import {
  buildAdminPluginPageContext,
  getDefaultAdminUseTypes,
  normalizeAdminUseType,
  normalizeAdminUseTypes,
} from "@/lib/admin-plugin-context";

type EnvironmentBadge = {
  show?: boolean;
  label?: string;
  environment?: "development" | "production";
};

type FloatingWidget = {
  id?: string;
  title?: string;
  content?: string;
  position?: "bottom-right";
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId")?.trim() || "";
  const path = url.searchParams.get("path")?.trim() || "";
  const environment = process.env.NODE_ENV === "development" ? "development" : "production";
  const kernel = await createKernelForRequest(siteId || undefined);
  const page = buildAdminPluginPageContext(path, siteId || null);
  const pluginStates = siteId ? await listPluginsWithSiteState(siteId) : await listPluginsWithState();
  const hasAnalyticsProviders = pluginStates.some((plugin: any) => {
    const isAnalytics = String(plugin?.id || "").startsWith("analytics-");
    if (!isAnalytics) return false;
    return siteId ? Boolean(plugin?.enabled && plugin?.siteEnabled) : Boolean(plugin?.enabled);
  });

  const useTypeContext = {
    siteId: siteId || null,
    environment,
    path,
    page,
  };

  const allowedUseTypes = normalizeAdminUseTypes(
    await kernel.applyFilters<string[]>("admin:context-use-types", getDefaultAdminUseTypes(), useTypeContext),
  );
  const contextUseType = await kernel.applyFilters<string>("admin:context-use-type", "default", useTypeContext);
  // Backward-compatible alias for pre-registry hook name.
  const legacyUseType = await kernel.applyFilters<string>("admin:brand-use-type", contextUseType, useTypeContext);
  const useType = normalizeAdminUseType(legacyUseType, allowedUseTypes);

  const badge = await kernel.applyFilters<EnvironmentBadge | null>("admin:environment-badge", null, {
    siteId: siteId || null,
    environment,
    path,
    page,
    use_type: useType,
  });

  const widgets = await kernel.applyFilters<FloatingWidget[]>("admin:floating-widgets", [], {
    siteId: siteId || null,
    environment,
    path,
    page,
    use_type: useType,
  });

  return NextResponse.json({
    hasAnalyticsProviders,
    environmentBadge: {
      show: Boolean(badge?.show),
      label: String(badge?.label || ""),
      environment: badge?.environment === "development" ? "development" : "production",
    },
    use_type: useType,
    use_types: allowedUseTypes,
    page,
    floatingWidgets: Array.isArray(widgets)
      ? widgets
          .map((widget) => ({
            id: String(widget.id || ""),
            title: String(widget.title || ""),
            content: String(widget.content || ""),
            position: widget.position === "bottom-right" ? "bottom-right" : "bottom-right",
          }))
          .filter((widget) => widget.id && widget.content)
      : [],
  });
}
