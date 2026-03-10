import { NextResponse } from "next/server";
import { createDomainPost } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { resolveAuthorizedSiteForUser } from "@/lib/admin-site-selection";
import { getDomainPostAdminItemPath, getDomainPostAdminListPath } from "@/lib/domain-post-admin-routes";

type RouteContext = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { id, domainKey } = await context.params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);

  const { site } = await resolveAuthorizedSiteForUser(session.user.id, siteId, "site.content.create");
  if (!site) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  const effectiveSiteId = site.id;
  const listPath = getDomainPostAdminListPath(effectiveSiteId, resolvedDomainKey);
  const formData = await request.formData().catch(() => null);
  const created = await createDomainPost(formData, effectiveSiteId, resolvedDomainKey);

  if ((created as any)?.error || !(created as any)?.id) {
    return NextResponse.redirect(new URL(listPath, request.url), { status: 303 });
  }

  const createdPostId = String((created as any).id);
  const targetPath = getDomainPostAdminItemPath(effectiveSiteId, resolvedDomainKey, createdPostId);
  return NextResponse.redirect(new URL(`${targetPath}?pending=1`, request.url), { status: 303 });
}
