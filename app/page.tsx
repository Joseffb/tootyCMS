import type { Metadata } from "next";
import SiteHomePage from "./[domain]/page";
import { getSiteData } from "@/lib/fetchers";
import { getThemeAssetsForSite } from "@/lib/theme-runtime";
import Script from "next/script";
import { getInstallState } from "@/lib/install-state";
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import FrontendAuthBridge from "@/components/frontend-auth-bridge";
import { getAdminPathAlias } from "@/lib/admin-path";
import { getThemeCacheBustToken, withCacheBust } from "@/lib/theme-cache-bust";

export const metadata: Metadata = {
  title: "Tooty CMS",
  description: "Tooty CMS",
};
export const revalidate = 60;

function normalizeConfiguredHost(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

export default async function RootPage() {
  if (process.env.NODE_ENV === "development") {
    noStore();
  }

  const installState = await getInstallState();
  if (installState.setupRequired) {
    redirect("/setup");
  }
  const rootDomain =
    normalizeConfiguredHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "") || "localhost";
  const mainDomain = rootDomain;
  const mainSite = await getSiteData(mainDomain);
  const [themeAssets, cacheBustToken] = mainSite?.id
    ? await Promise.all([
        getThemeAssetsForSite(mainSite.id as string),
        getThemeCacheBustToken(mainSite.id as string),
      ])
    : [{ styles: [], scripts: [] }, "0"];

  return (
    <>
      {themeAssets.styles.map((href: string) => (
        <link key={href} rel="stylesheet" href={withCacheBust(href, cacheBustToken)} />
      ))}
      <FrontendAuthBridge
        adminPathAlias={getAdminPathAlias()}
        rootDomain={process.env.NEXT_PUBLIC_ROOT_DOMAIN || ""}
      />
      <SiteHomePage params={Promise.resolve({ domain: mainDomain })} />
      {themeAssets.scripts.map((src: string) => (
        <Script key={src} src={withCacheBust(src, cacheBustToken)} strategy="afterInteractive" />
      ))}
    </>
  );
}
