export type DomainPostAdminView = "cards" | "list";

export const DOMAIN_POST_ADMIN_VIEW_COOKIE = "tooty_domain_posts_view";

export function normalizeDomainPostAdminView(input: string | null | undefined): DomainPostAdminView | null {
  const normalized = String(input || "").trim().toLowerCase();
  if (normalized === "cards") return "cards";
  if (normalized === "list") return "list";
  return null;
}

export function resolveDomainPostAdminView(input: {
  searchParam?: string | null;
  cookieValue?: string | null;
}): DomainPostAdminView {
  return (
    normalizeDomainPostAdminView(input.searchParam) ||
    normalizeDomainPostAdminView(input.cookieValue) ||
    "cards"
  );
}
