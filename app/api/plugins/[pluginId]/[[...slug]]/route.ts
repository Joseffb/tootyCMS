import { dispatchPluginRouteRequest } from "@/lib/plugin-routes";

type RouteContext = {
  params: Promise<{
    pluginId?: string;
    slug?: string[];
  }>;
};

async function handle(request: Request, context: RouteContext) {
  const params = await context.params;
  return dispatchPluginRouteRequest({
    request,
    pluginId: String(params?.pluginId || "").trim(),
    slug: Array.isArray(params?.slug) ? params.slug : [],
  });
}

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handle(request, context);
}

