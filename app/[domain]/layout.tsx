import { notFound } from "next/navigation";
import { getSiteData } from "@/lib/fetchers";
import { Metadata } from "next";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getSiteThemeTokens } from "@/lib/themes";
import { getSiteMenu } from "@/lib/menu-system";
import { getThemeAssetsForSite } from "@/lib/theme-runtime";
import Script from "next/script";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}): Promise<Metadata | null> {
  const { domain } = await params; // ✅ Fix here
  const decoded = decodeURIComponent(domain);
  const data = await getSiteData(decoded);

  if (!data) return null;
  const {
    name: title,
    description,
    image,
    logo,
  } = data as {
    name: string;
    description: string;
    image: string;
    logo: string;
  };

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      creator: "@vercel",
    },
    // icons: [logo],
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
  const [_themeTokens, themeAssets, baseHeaderMenu, kernel] = await Promise.all([
    getSiteThemeTokens(siteId),
    getThemeAssetsForSite(siteId),
    getSiteMenu(siteId, "header"),
    createKernelForRequest(),
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

  return (
    <>
      {themeAssets.styles.map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {children}
      {themeAssets.scripts.map((src: string) => (
        <Script key={src} src={src} strategy="afterInteractive" />
      ))}
    </>
  );
}
