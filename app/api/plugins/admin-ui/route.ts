import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { listPluginsWithSiteState } from "@/lib/plugins";

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
  const environment = process.env.NODE_ENV === "development" ? "development" : "production";
  const kernel = await createKernelForRequest(siteId || undefined);
  const plugins = siteId ? await listPluginsWithSiteState(siteId) : [];
  const hasAnalyticsProviders = plugins.some(
    (plugin) =>
      (plugin.scope || "site") === "site" &&
      plugin.id.startsWith("analytics-") &&
      plugin.enabled &&
      plugin.siteEnabled,
  );

  const badge = await kernel.applyFilters<EnvironmentBadge | null>("admin:environment-badge", null, {
    siteId: siteId || null,
    environment,
  });

  const widgets = await kernel.applyFilters<FloatingWidget[]>("admin:floating-widgets", [], {
    siteId: siteId || null,
    environment,
  });

  return NextResponse.json({
    hasAnalyticsProviders,
    environmentBadge: {
      show: Boolean(badge?.show),
      label: String(badge?.label || ""),
      environment: badge?.environment === "development" ? "development" : "production",
    },
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
