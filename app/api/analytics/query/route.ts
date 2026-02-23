import { NextRequest, NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { resolveAnalyticsSiteId } from "@/lib/analytics-site";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const incoming = new URL(req.url);
  const name = incoming.searchParams.get("name");
  if (!name) return new NextResponse("Missing ?name=", { status: 400 });
  const siteId = await resolveAnalyticsSiteId({
    headers: req.headers,
    domainHint: incoming.searchParams.get("domain"),
  });
  const kernel = await createKernelForRequest(siteId);

  const response = await kernel.applyFilters<Response | NextResponse | null>(
    "analytics:query",
    null,
    {
      request: req,
      name,
      params: Object.fromEntries(incoming.searchParams.entries()),
    },
  );

  if (!response) {
    return NextResponse.json(
      {
        data: [],
        meta: { provider: null, fallback: true, reason: "no_analytics_provider" },
      },
      { status: 200 },
    );
  }

  if (response instanceof NextResponse) return response;
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
