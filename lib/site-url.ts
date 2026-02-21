export function getRootSiteUrl() {
  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function getSitePublicUrl(input: {
  subdomain?: string | null;
  customDomain?: string | null;
  isPrimary?: boolean;
}) {
  if (input.customDomain) {
    return `https://${input.customDomain}`;
  }

  const root = getRootSiteUrl();
  const sub = (input.subdomain || "").trim().toLowerCase();
  if (input.isPrimary || sub === "main" || !sub) {
    return root;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${sub}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;
  }

  return `http://${sub}.localhost:${process.env.PORT ?? 3000}`;
}
