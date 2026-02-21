"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import EmailLink from "@/components/email-link";
import type { MenuItem } from "@/lib/kernel";
import type { ThemeTokens } from "@/lib/theme-system";
import { getSitePublicUrl } from "@/lib/site-url";

interface MainProps {
  children?: ReactNode;
  data: {
    name: string;
    subdomain: string;
    font: string;
  };
  domain?: string;
  menuItems?: MenuItem[];
  themeTokens?: ThemeTokens;
  showNetworkSites?: boolean;
  networkSites?: Array<{
    id: string;
    name: string | null;
    subdomain: string | null;
    customDomain: string | null;
    isPrimary: boolean;
  }>;
}

const fontMapper: Record<string, string> = {
  default: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
};

function slugifyName(name: string) {
  return (
    "about_" +
    name
      .replace(/&/g, "and")
      .replace(/\s+/g, "_")
      .toLowerCase()
  );
}

const defaultThemeTokens: ThemeTokens = {
  shellBg: "bg-[#f3e8d0]",
  shellText: "text-stone-900",
  topMuted: "text-stone-600",
  titleText: "text-stone-900",
  navText: "text-stone-700",
  navHover: "hover:text-orange-600",
};

export default function Main({
  children,
  data,
  domain,
  menuItems = [],
  themeTokens,
  showNetworkSites = false,
  networkSites = [],
}: MainProps) {
  const [showContact, setShowContact] = useState(false);
  const [canOpenDashboard, setCanOpenDashboard] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return;
        const session = await res.json();
        const role = session?.user?.role as string | undefined;
        if (isMounted) {
          setCanOpenDashboard(role === "administrator" || role === "editor");
        }
      } catch {
        if (isMounted) {
          setCanOpenDashboard(false);
        }
      }
    }

    loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const isLocal = domain?.includes("localhost") ?? false;
  const protocol = isLocal ? "http://" : "https://";
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";

  const dynamicUrl = getSitePublicUrl({ isPrimary: true, subdomain: "main" });
  const subDomainUrl = getSitePublicUrl({
    subdomain: data.subdomain,
    customDomain: null,
    isPrimary: data.subdomain === "main",
  });

  const ipName = data.name;
  const showTopTitle = data.name !== "Tooty CMS";
  const isRoot = !data.subdomain || data.subdomain === "www" || data.name === "Tooty CMS";
  const tokens = themeTokens || defaultThemeTokens;

  function getSiteUrl(site: { subdomain: string | null; customDomain: string | null; isPrimary: boolean }) {
    if (site.isPrimary) {
      return isLocal ? "http://localhost:3000" : `${protocol}${rootDomain}`;
    }
    if (site.customDomain) {
      return `${protocol}${site.customDomain}`;
    }
    if (site.subdomain) {
      return getSitePublicUrl({
        subdomain: site.subdomain,
        customDomain: site.customDomain,
        isPrimary: site.isPrimary || site.subdomain === "main",
      });
    }
    return dynamicUrl;
  }

  return (
    <div className={`${fontMapper[data.font] || fontMapper.default} ${tokens.shellBg} ${tokens.shellText}`}>
      <div
        className={`mx-auto ${
          isRoot ? "mt-5" : ""
        } relative z-[9999] flex w-full max-w-screen-xl flex-col items-center justify-center px-6 text-center sm:px-10`}
      >
        {showTopTitle && (
          <Link href={dynamicUrl} className={`block text-sm font-medium ${tokens.topMuted}`}>
            Tooty CMS
          </Link>
        )}

        <Link href={subDomainUrl} className={`block text-sm font-medium ${tokens.topMuted}`}>
          <span className={`block font-title text-2xl font-semibold ${tokens.titleText}`}>{ipName}</span>
        </Link>

        <nav className={`flex flex-wrap justify-center gap-4 text-sm font-medium ${tokens.navText}`}>
          {menuItems.map((item) =>
            item.external ? (
              <a key={`${item.href}-${item.label}`} href={item.href} target="_blank" rel="noreferrer" className={tokens.navHover}>
                {item.label}
              </a>
            ) : (
              <Link key={`${item.href}-${item.label}`} href={item.href} className={tokens.navHover}>
                {item.label}
              </Link>
            ),
          )}
          {canOpenDashboard && <Link href="/app">Dashboard</Link>}
          {canOpenDashboard && <Link href="/app/sites">Sites</Link>}
          {showNetworkSites && networkSites.length > 0 && (
            <details className="group relative">
              <summary className="cursor-pointer list-none hover:text-primary">Network</summary>
              <div className="absolute right-0 z-[10001] mt-2 max-h-72 min-w-[240px] overflow-auto rounded-lg border border-stone-200 bg-white p-2 text-left shadow-lg">
                {networkSites.map((site) => (
                  <a
                    key={site.id}
                    href={getSiteUrl(site)}
                    className="block rounded px-2 py-1.5 text-xs text-stone-700 hover:bg-stone-100"
                  >
                    {site.name || site.subdomain || site.customDomain || site.id}
                  </a>
                ))}
              </div>
            </details>
          )}
          <button
            type="button"
            onClick={() => setShowContact(true)}
            className="hover:text-primary"
          >
            Contact
          </button>
        </nav>
      </div>

      {showContact && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
          onClick={() => setShowContact(false)}
        >
          <div
            className="w-80 rounded-lg bg-white p-6 text-left shadow-lg dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-semibold text-black dark:text-white">
              Contact Tooty CMS
            </h2>
            <p className="mb-2 dark:text-white">
              Email:&nbsp;
              <EmailLink
                encoded="c3VwcG9ydEB0b290eWNtcy5jb20="
                className="text-primary underline"
              />
            </p>
            <button
              onClick={() => setShowContact(false)}
              className="rounded bg-primary px-4 py-1 text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="px-4 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}
