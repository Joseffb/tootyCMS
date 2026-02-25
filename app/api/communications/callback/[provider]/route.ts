import { NextRequest, NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { applyCommunicationCallback } from "@/lib/communications";
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
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const providerId = String(provider || "").trim();
  if (!providerId) return NextResponse.json({ error: "Provider is required." }, { status: 400 });

  const body = await req.text();
  const headers = toHeaderMap(req.headers);
  const query = toQueryMap(req.nextUrl.searchParams);
  const signature = await verifyInboundSignature({
    context: "communications-callback",
    headers,
    rawBody: body,
  });
  if (!signature.ok) {
    return NextResponse.json({ error: "Signature verification failed.", reason: signature.reason }, { status: 401 });
  }

  if (providerId === "native-null" || providerId === "native:null-provider") {
    const parsed = (() => {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const applied = await applyCommunicationCallback({
      providerId: "native:null-provider",
      messageId: String(parsed.messageId || ""),
      eventId: String(parsed.eventId || headers["x-tooty-event-id"] || ""),
      status:
        parsed.status === "failed" || parsed.status === "dead" || parsed.status === "logged"
          ? (parsed.status as "failed" | "dead" | "logged")
          : "sent",
      error: String(parsed.error || ""),
      metadata: parsed.metadata && typeof parsed.metadata === "object" ? (parsed.metadata as Record<string, unknown>) : {},
      eventType: String(parsed.eventType || "native-null-callback"),
    });
    if (!applied.ok) return NextResponse.json({ error: applied.reason }, { status: 404 });
    return NextResponse.json({ ok: true, messageId: applied.messageId }, { status: 202 });
  }

  const kernel = await createKernelForRequest();
  const providerReg = kernel.getAllPluginCommunicationProviders().find((entry) => {
    const full = `${entry.pluginId}:${entry.id}`;
    return entry.id === providerId || full === providerId;
  });
  if (!providerReg || typeof providerReg.handleCallback !== "function") {
    return NextResponse.json({ error: "Callback provider not registered." }, { status: 404 });
  }

  const callbackResult = await providerReg.handleCallback({
    body,
    headers,
    query,
  });
  if (!callbackResult?.ok) {
    return NextResponse.json(
      { error: callbackResult?.error || "Callback rejected." },
      { status: 400 },
    );
  }

  const applied = await applyCommunicationCallback({
    providerId: `${providerReg.pluginId}:${providerReg.id}`,
    messageId: callbackResult.messageId,
    externalId: callbackResult.externalId,
    eventId: String(
      (callbackResult.metadata && typeof callbackResult.metadata === "object"
        ? (callbackResult.metadata as Record<string, unknown>).eventId
        : "") ||
        query.eventId ||
        query.event_id ||
        headers["x-tooty-event-id"] ||
        "",
    ),
    status: callbackResult.status,
    error: callbackResult.error,
    metadata: callbackResult.metadata,
    eventType: callbackResult.eventType,
  });
  if (!applied.ok) {
    return NextResponse.json({ error: applied.reason }, { status: 404 });
  }

  return NextResponse.json({ ok: true, messageId: applied.messageId }, { status: 202 });
}
