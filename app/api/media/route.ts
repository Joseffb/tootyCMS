import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";
import { media, sites, users } from "@/lib/schema";
import { trace } from "@/lib/debug";

export async function GET(req: Request) {
  const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
  trace("media.api", "request start", { traceId, url: req.url });
  const session = await getSession();
  if (!session?.user?.id) {
    trace("media.api", "unauthorized", { traceId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  if (!siteId) {
    trace("media.api", "missing siteId", { traceId });
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const actor = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, userId: true },
  });
  if (!site) {
    trace("media.api", "site not found", { traceId, siteId });
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const canAccess = actor?.role === "admin" || actor?.role === "administrator" || site.userId === session.user.id;
  if (!canAccess) {
    trace("media.api", "forbidden", { traceId, siteId, userId: session.user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: media.id,
      url: media.url,
      objectKey: media.objectKey,
      label: media.label,
      mimeType: media.mimeType,
      size: media.size,
      provider: media.provider,
      createdAt: media.createdAt,
    })
    .from(media)
    .where(eq(media.siteId, siteId))
    .orderBy(desc(media.createdAt));
  trace("media.api", "request success", { traceId, siteId, count: rows.length });

  return NextResponse.json({ items: rows });
}
