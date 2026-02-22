import { getAllDataDomains } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { pluralizeLabel } from "@/lib/data-domain-labels";
import { sites } from "@/lib/schema";
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
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { userId: true },
  });
  if (!site || site.userId !== session.user.id) {
    return NextResponse.json({ items: [] });
  }

  const domains = await getAllDataDomains(siteId);
  const items = domains
    .filter((domain: any) => domain.key !== "post" && domain.assigned)
    .map((domain: any) => ({
      id: domain.id,
      label: pluralizeLabel(domain.label),
      href: `/site/${siteId}/domain/${domain.key}`,
    }));

  return NextResponse.json({ items });
}
