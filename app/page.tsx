import type { Metadata } from "next";
import SiteHomePage from "./[domain]/page";
import { getSiteData } from "@/lib/fetchers";
import { getThemeAssetsForSite } from "@/lib/theme-runtime";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Tooty CMS",
  description: "Tooty CMS",
};

export default async function RootPage() {
  const rootDomainRaw = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
  const rootDomain = rootDomainRaw.replace(/:\d+$/, "");
  const mainDomain = `main.${rootDomain}`;
  const mainSite = await getSiteData(mainDomain);
  const themeAssets = mainSite?.id
    ? await getThemeAssetsForSite(mainSite.id as string)
    : { styles: [], scripts: [] };

  return (
    <>
      {themeAssets.styles.map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <SiteHomePage params={Promise.resolve({ domain: mainDomain })} />
      {themeAssets.scripts.map((src: string) => (
        <Script key={src} src={src} strategy="afterInteractive" />
      ))}
    </>
  );
}
