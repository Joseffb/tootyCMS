import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import db from "@/lib/db";
import { communicationMessages, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { adminRetryCommunicationMessage, adminSetCommunicationStatus } from "@/lib/communications";

type Body = {
  action?: "retry" | "requeue" | "mark_dead";
  siteId?: string | null;
};

function normalize(value: unknown) {
  return String(value || "").trim();
}

async function resolveActorLabel(userId: string) {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      username: true,
      name: true,
      email: true,
    },
  });
  return normalize(row?.username) || normalize(row?.name) || normalize(row?.email) || userId;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const messageId = normalize(id);
  if (!messageId) {
    return NextResponse.json({ ok: false, error: "Message id is required." }, { status: 400 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = normalize(body.action) as Body["action"];
  const siteId = normalize(body.siteId);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action is required." }, { status: 400 });
  }

  const row = await db.query.communicationMessages.findFirst({
    where: eq(communicationMessages.id, messageId),
    columns: {
      id: true,
      siteId: true,
    },
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
  }

  const canManageNetwork = await userCan("network.plugins.manage", session.user.id);
  if (!canManageNetwork) {
    if (!siteId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const canManageSite = await userCan("site.plugins.manage", session.user.id, { siteId });
    if (!canManageSite) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (!row.siteId || row.siteId !== siteId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    if (action === "retry") {
      const result = await adminRetryCommunicationMessage(messageId);
      return NextResponse.json({ ok: true, action, result });
    }
    if (action === "requeue") {
      const result = await adminSetCommunicationStatus({ messageId, status: "queued", error: null });
      return NextResponse.json({ ok: true, action, result });
    }
    if (action === "mark_dead") {
      const actorLabel = await resolveActorLabel(session.user.id);
      const result = await adminSetCommunicationStatus({
        messageId,
        status: "dead",
        error: `Cancelled by ${actorLabel}.`,
      });
      return NextResponse.json({ ok: true, action, result });
    }
    return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update message." },
      { status: 500 },
    );
  }
}
