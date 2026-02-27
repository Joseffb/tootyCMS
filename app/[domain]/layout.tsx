import { notFound } from "next/navigation";
import { getSiteData } from "@/lib/fetchers";
import { Metadata } from "next";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getSiteMenu } from "@/lib/menu-system";
import { getActiveThemeForSite, getThemeAssetsForSite } from "@/lib/theme-runtime";
import {
  getSiteTextSetting,
  SEO_META_DESCRIPTION_KEY,
  SEO_META_TITLE_KEY,
  SOCIAL_META_DESCRIPTION_KEY,
  SOCIAL_META_IMAGE_KEY,
  SOCIAL_META_TITLE_KEY,
} from "@/lib/cms-config";
import Script from "next/script";
import FrontendAuthBridge from "@/components/frontend-auth-bridge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}): Promise<Metadata | null> {
  const { domain } = await params; // ✅ Fix here
  const decoded = decodeURIComponent(domain);
  const data = await getSiteData(decoded);

  if (!data) return null;
  const siteId = data.id ? String(data.id) : "";
  const [activeTheme, seoSettings] = await Promise.all([
    siteId ? getActiveThemeForSite(siteId) : Promise.resolve(null),
    siteId
      ? Promise.all([
          getSiteTextSetting(siteId, SEO_META_TITLE_KEY, ""),
          getSiteTextSetting(siteId, SEO_META_DESCRIPTION_KEY, ""),
          getSiteTextSetting(siteId, SOCIAL_META_TITLE_KEY, ""),
          getSiteTextSetting(siteId, SOCIAL_META_DESCRIPTION_KEY, ""),
          getSiteTextSetting(siteId, SOCIAL_META_IMAGE_KEY, ""),
        ])
      : Promise.resolve(["", "", "", "", ""] as const),
  ]);
  const themeConfig = (activeTheme?.config || {}) as Record<string, unknown>;
  const configuredTitle = String(themeConfig.site_title || "").trim();
  const configuredFavicon = String(themeConfig.site_favicon_url || "").trim();
  const [seoMetaTitle, seoMetaDescription, socialMetaTitle, socialMetaDescription, socialMetaImage] = seoSettings;
  const {
    name,
    description,
    image,
    logo,
    heroSubtitle,
  } = data as {
    name: string;
    description: string;
    image: string;
    logo: string;
    heroSubtitle?: string | null;
  };
  const defaultDescription = (heroSubtitle || description || "").trim();
  const title = seoMetaTitle || configuredTitle || name;
  const seoDescription = seoMetaDescription || defaultDescription;
  const ogTitle = socialMetaTitle || title;
  const ogDescription = socialMetaDescription || seoDescription;
  const ogImage = socialMetaImage || image || logo || "/icon.png";
  const favicon = configuredFavicon || logo || "/icon.png";

  return {
    title,
    description: seoDescription,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
      images: [ogImage],
      creator: "@vercel",
    },
    icons: {
      icon: [favicon],
      shortcut: [favicon],
      apple: [favicon],
    },
    metadataBase: new URL(`https://${decoded}`),
    // Optional: Set canonical URL to custom domain if it exists
    // ...(params.domain.endsWith(`.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`) &&
    //   data.customDomain && {
    //     alternates: {
    //       canonical: `https://${data.customDomain}`,
    //     },
    //   }),
  };
}

export default async function SiteLayout({
  params,
  children,
}: {
  params: Promise<{ domain: string }>;
  children: React.ReactNode;
}) {
  const { domain } = await params; // ✅ Await before use
  const decoded = decodeURIComponent(domain);
  const data = await getSiteData(decoded);

  if (!data) {
    notFound();
  }
  const siteId = data.id as string;
  const [themeAssets, baseHeaderMenu, kernel] = await Promise.all([
    getThemeAssetsForSite(siteId),
    getSiteMenu(siteId, "header"),
    createKernelForRequest(siteId),
  ]);

  await kernel.doAction("request:begin", { domain: decoded, siteId });
  await kernel.doAction("render:before", { domain: decoded, siteId });

  const menuItems = await kernel.applyFilters("nav:items", baseHeaderMenu, {
    location: "header",
    domain: decoded,
    siteId,
  });
  await kernel.doAction("render:after", { domain: decoded, siteId, location: "header" });
  await kernel.doAction("request:end", { domain: decoded, siteId });
  const enqueuedAssets = kernel.getEnqueuedAssets();
  const enqueuedStyles = enqueuedAssets.filter((asset) => asset.kind === "style");
  const enqueuedScripts = enqueuedAssets.filter((asset) => asset.kind === "script");

  return (
    <>
      {themeAssets.styles.map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {enqueuedStyles.map((asset) =>
        asset.inline ? (
          <style
            key={asset.id}
            {...(asset.attrs || {})}
            dangerouslySetInnerHTML={{ __html: asset.inline || "" }}
          />
        ) : (
          <link
            key={asset.id}
            rel={(asset.attrs || {}).rel || "stylesheet"}
            href={asset.src || ""}
            {...(asset.attrs || {})}
          />
        ),
      )}
      <FrontendAuthBridge />
      {children}
      {themeAssets.scripts.map((src: string) => (
        <Script key={src} src={src} strategy="afterInteractive" />
      ))}
      {enqueuedScripts.map((asset) =>
        asset.src ? (
          <Script
            key={asset.id}
            id={asset.id}
            src={asset.src}
            strategy={asset.strategy || "afterInteractive"}
            {...(asset.attrs || {})}
          />
        ) : (
          <Script
            key={asset.id}
            id={asset.id}
            strategy={asset.strategy || "afterInteractive"}
            {...(asset.attrs || {})}
          >
            {asset.inline || ""}
          </Script>
        ),
      )}
    </>
  );
}
