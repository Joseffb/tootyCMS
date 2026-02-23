import { NextRequest, NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kernel = await createKernelForRequest();
  const incoming = new URL(req.url);
  const name = incoming.searchParams.get("name");
  if (!name) return new NextResponse("Missing ?name=", { status: 400 });

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
