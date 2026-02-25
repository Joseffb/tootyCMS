import { NextRequest, NextResponse } from "next/server";
import { dispatchWebcallback } from "@/lib/webcallbacks";
import { verifyInboundSignature } from "@/lib/signing";

export const runtime = "nodejs";

function toHeaderMap(headers: Headers) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function toQueryMap(searchParams: URLSearchParams) {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key in output) {
      const current = output[key];
      output[key] = Array.isArray(current) ? [...current, value] : [String(current), value];
    } else {
      output[key] = value;
    }
  }
  return output;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ handler: string }> },
) {
  const { handler } = await context.params;
  const handlerId = String(handler || "").trim();
  if (!handlerId) return NextResponse.json({ error: "Handler is required." }, { status: 400 });

  const body = await req.text();
  const headers = toHeaderMap(req.headers);
  const query = toQueryMap(req.nextUrl.searchParams);
  const siteId = String(query.site_id || query.siteId || headers["x-tooty-site-id"] || "").trim() || null;
  const signature = await verifyInboundSignature({
    context: "webcallback",
    headers,
    rawBody: body,
  });
  if (!signature.ok) {
    return NextResponse.json({ error: "Signature verification failed.", reason: signature.reason }, { status: 401 });
  }

  const result = await dispatchWebcallback({
    handlerId,
    siteId,
    body,
    headers,
    query,
  });
  return NextResponse.json(
    { ok: result.ok, message: result.message, eventId: (result as any).eventId },
    { status: result.statusCode },
  );
}
