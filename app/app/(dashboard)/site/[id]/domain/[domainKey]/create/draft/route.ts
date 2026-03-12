import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveAuthorizedSiteForUser } from "@/lib/admin-site-selection";
import { getDomainPostAdminItemPath } from "@/lib/domain-post-admin-routes";
import { deriveRequestOriginFromRequest } from "@/lib/request-origin";
import { createId } from "@paralleldrive/cuid2";

type RouteContext = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const requestOrigin = deriveRequestOriginFromRequest(request);
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", requestOrigin));
  }

  const { id, domainKey } = await context.params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);

  const { site } = await resolveAuthorizedSiteForUser(session.user.id, siteId, "site.content.create");
  if (!site) {
    return NextResponse.redirect(new URL("/app", requestOrigin));
  }

  const effectiveSiteId = site.id;
  const formData = await request.formData().catch(() => null);
  const requestedDraftNonce = String(formData?.get("draftNonce") || "").trim().toLowerCase();
  const draftId =
    requestedDraftNonce && /^[a-z0-9][a-z0-9_-]{7,127}$/.test(requestedDraftNonce)
      ? requestedDraftNonce
      : createId();
  const targetPath = getDomainPostAdminItemPath(effectiveSiteId, resolvedDomainKey, draftId);
  return NextResponse.redirect(new URL(`${targetPath}?new=1`, requestOrigin), { status: 303 });
}
