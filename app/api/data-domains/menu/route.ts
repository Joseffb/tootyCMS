import { getAllDataDomains } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ items: [] });
  }

  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ items: [] });
  }
  const actor = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ items: [] });
  }

  const domains = await getAllDataDomains(siteId);
  const items = domains
    .filter((domain: any) => domain.isActive)
    .map((domain: any) => ({
      id: domain.id,
      label: domain.label,
      href: `/site/${siteId}/settings/domains?dataDomain=${domain.id}`,
    }));

  return NextResponse.json({ items });
}

