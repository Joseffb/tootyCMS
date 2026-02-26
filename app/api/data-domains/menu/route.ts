import { getAllDataDomains } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { pluralizeLabel, singularizeLabel } from "@/lib/data-domain-labels";
import { canUserCreateDomainContent } from "@/lib/authorization";
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
  const canAccess = await canUserCreateDomainContent(session.user.id, siteId);
  if (!canAccess) {
    return NextResponse.json({ items: [] });
  }

  const domains = await getAllDataDomains(siteId);
  const items = domains
    .filter((domain: any) => domain.assigned)
    .map((domain: any) => ({
      id: domain.id,
      label: pluralizeLabel(domain.label),
      singular: singularizeLabel(domain.label),
      order: (() => {
        const rawSettings = domain?.settings;
        const parsed = typeof rawSettings === "string"
          ? (() => {
              try {
                return JSON.parse(rawSettings);
              } catch {
                return {};
              }
            })()
          : (rawSettings || {});
        const rawOrder = parsed?.menuOrder ?? parsed?.order;
        const n = Number(rawOrder);
        return Number.isFinite(n) ? n : undefined;
      })(),
      listHref: `/site/${siteId}/domain/${domain.key}`,
      addHref: `/site/${siteId}/domain/${domain.key}/create`,
    }))
    .sort((a, b) => {
      const aHasOrder = Number.isFinite(a.order);
      const bHasOrder = Number.isFinite(b.order);
      if (aHasOrder && bHasOrder && a.order !== b.order) return a.order - b.order;
      if (aHasOrder && !bHasOrder) return -1;
      if (!aHasOrder && bHasOrder) return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });

  return NextResponse.json({ items });
}
