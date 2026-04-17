import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { runAiRequest } from "@/lib/ai-spine";
import { evaluateBotIdRoute } from "@/lib/botid";
import { trace } from "@/lib/debug";

function createTraceId(request: Request) {
  const incoming = request.headers.get("x-trace-id") || "";
  if (incoming.trim()) return incoming.trim();
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ai-route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function statusForResult(result: Awaited<ReturnType<typeof runAiRequest>>) {
  if (result.ok) return 200;
  const error = String(result.error || "").toLowerCase();
  if (error.includes("quota")) return 429;
  if (error.includes("permission")) return 403;
  if (error.includes("provider-shaped field")) return 400;
  if (error.includes("unknown ai provider")) return 400;
  if (error.includes("does not support action")) return 400;
  if (error.includes("configured") || error.includes("provider")) return 503;
  return 400;
}

export async function POST(request: Request) {
  const traceId = createTraceId(request);
  trace("ai.route", "request begin", { traceId, url: request.url });

  const session = await getSession();
  if (!session?.user?.id) {
    trace("ai.route", "unauthorized", { traceId });
    return NextResponse.json({ ok: false, error: "Unauthorized", traceId }, { status: 401 });
  }

  const botId = await evaluateBotIdRoute("api_ai_run");
  if (!botId.allowed) {
    trace("ai.route", "blocked by botid", { traceId, mode: botId.mode, reason: botId.reason });
    return NextResponse.json(
      { ok: false, error: "Request blocked by BotID policy.", traceId },
      {
        status: 403,
        headers: {
          "x-tooty-botid-mode": botId.mode,
          "x-tooty-botid-result": botId.reason,
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    trace("ai.route", "invalid json", { traceId });
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body.", traceId },
      {
        status: 400,
        headers: {
          "x-tooty-botid-mode": botId.mode,
          "x-tooty-botid-result": botId.reason,
        },
      },
    );
  }

  const siteIdHint =
    body && typeof body === "object" && (body as any).scope?.kind === "site"
      ? String((body as any).scope?.siteId || "").trim()
      : "";
  const kernel = await createKernelForRequest(siteIdHint || undefined);
  const result = await runAiRequest({
    request: body,
    actorUserId: String(session.user.id || "").trim(),
    providers: kernel.getAllAiProviders(),
    traceId,
  });

  const status = statusForResult(result);
  trace("ai.route", "request end", {
    traceId,
    status,
    ok: result.ok,
    decision: result.ok ? result.decision : undefined,
  });
  return NextResponse.json(result, {
    status,
    headers: {
      "x-tooty-botid-mode": botId.mode,
      "x-tooty-botid-result": botId.reason,
    },
  });
}
