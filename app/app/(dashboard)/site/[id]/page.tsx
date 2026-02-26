import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { getAuthorizedSiteForAnyCapability } from "@/lib/authorization";
import { getAllDataDomains } from "@/lib/actions";
type Props = {
  params: Promise<{
    id: string
  }>
}
export default async function SitePosts({ params }: Props) {
  const id = (await params).id;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const siteId = decodeURIComponent(id);
  const data = await getAuthorizedSiteForAnyCapability(session.user.id, siteId, [
    "site.content.create",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.publish",
  ]);
  if (!data) {
    notFound();
  }
  const domains = await getAllDataDomains(siteId);
  const assigned = domains
    .filter((domain: any) => domain.assigned)
    .map((domain: any) => ({
      key: String(domain.key || "").trim(),
      label: String(domain.label || "").trim(),
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
    }))
    .filter((domain: any) => domain.key.length > 0)
    .sort((a: any, b: any) => {
      const aHasOrder = Number.isFinite(a.order);
      const bHasOrder = Number.isFinite(b.order);
      if (aHasOrder && bHasOrder && a.order !== b.order) return a.order - b.order;
      if (aHasOrder && !bHasOrder) return -1;
      if (!aHasOrder && bHasOrder) return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });

  const firstDomainKey = assigned[0]?.key || "post";
  redirect(`/app/site/${siteId}/domain/${encodeURIComponent(firstDomainKey)}`);
}
