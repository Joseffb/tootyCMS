import { createDataDomain, getAllDataDomains } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const rows = await getAllDataDomains(siteId);
  return NextResponse.json({ domains: rows });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const actor = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const label = String(body?.label ?? "").trim();
  if (!label) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }

  const created = await createDataDomain({
    label,
    fields: Array.isArray(body?.fields) ? body.fields : [],
    siteId: typeof body?.siteId === "string" ? body.siteId : undefined,
    activateForSite: typeof body?.activateForSite === "boolean" ? body.activateForSite : true,
  });
  if ((created as any)?.error) {
    return NextResponse.json(created, { status: 400 });
  }
  return NextResponse.json({ domain: created }, { status: 201 });
}

