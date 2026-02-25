import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { CommunicationGovernanceError, sendCommunication } from "@/lib/communications";

export const runtime = "nodejs";

type Payload = {
  siteId?: string;
  channel?: "email" | "sms" | "mms" | "com-x";
  to?: string;
  subject?: string;
  body?: string;
  category?: "transactional" | "marketing";
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Payload | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const siteId = String(body.siteId || "").trim() || undefined;
  const allowed = siteId
    ? await userCan("site.settings.write", session.user.id, { siteId })
    : await userCan("network.plugins.manage", session.user.id);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await sendCommunication(
      {
        siteId,
        channel: body.channel || "email",
        to: String(body.to || ""),
        subject: String(body.subject || ""),
        body: String(body.body || ""),
        category: body.category === "marketing" ? "marketing" : "transactional",
        metadata: body.metadata || {},
        maxAttempts: Number(body.maxAttempts || 3),
      },
      {
        createdByUserId: session.user.id,
      },
    );
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof CommunicationGovernanceError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.status },
      );
    }
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      "code" in error &&
      (error as { status?: unknown }).status &&
      (error as { code?: unknown }).code
    ) {
      const status = Number((error as { status?: unknown }).status);
      if (status === 403 || status === 429) {
        const shaped = error as {
          message?: string;
          code?: string;
          details?: Record<string, unknown>;
        };
        return NextResponse.json(
          {
            error: shaped.message || "Communication governance rejected request.",
            code: shaped.code,
            ...(shaped.details ? { details: shaped.details } : {}),
          },
          { status },
        );
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send communication." },
      { status: 400 },
    );
  }
}
