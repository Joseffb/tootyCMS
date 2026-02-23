"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Edit3,
  Globe,
  LayoutDashboard,
  Menu,
  Newspaper,
  Settings,
} from "lucide-react";
import { useParams, usePathname, useSelectedLayoutSegments } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { getSiteFromPostId } from "@/lib/actions";
import Image from "next/image";
import { getSitePublicUrl } from "@/lib/site-url";

const externalLinks: any[] = [];

export default function Nav({ children }: { children: ReactNode }) {
  const tootyHomeHref = getSitePublicUrl({ isPrimary: true, subdomain: "main" });
  const segments = useSelectedLayoutSegments();
  const { id } = useParams() as { id?: string };
  const pathname = usePathname();

  const [siteId, setSiteId] = useState<string | null>();
  const [pluginTabs, setPluginTabs] = useState<Array<{ name: string; href: string }>>([]);
  const [dataDomainTabs, setDataDomainTabs] = useState<Array<{ name: string; href: string }>>([]);
  const [environmentBadge, setEnvironmentBadge] = useState<{
    show: boolean;
    label: string;
    environment: "development" | "production";
  }>({
    show: false,
    label: "",
    environment: "production",
  });
  const [floatingWidgets, setFloatingWidgets] = useState<
    Array<{ id: string; title: string; content: string; position: "bottom-right" }>
  >([]);
  const [hasAnalyticsProviders, setHasAnalyticsProviders] = useState(false);
  const currentSiteId = segments[0] === "site" && id ? id : segments[0] === "post" ? siteId ?? null : null;

  useEffect(() => {
    if (segments[0] === "post" && id) {
      getSiteFromPostId(id).then((site) => setSiteId(site));
    }
  }, [segments, id]);

  useEffect(() => {
    fetch("/api/plugins/menu", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((json) => {
        if (!Array.isArray(json?.items)) {
          setPluginTabs([]);
          return;
        }
        setPluginTabs(
          json.items.map((item: any) => ({
            name: item.label,
            href: item.href,
          })),
        );
      })
      .catch(() => setPluginTabs([]));
  }, []);

  useEffect(() => {
    if (!currentSiteId) {
      setDataDomainTabs([]);
      return;
    }
    fetch(`/api/data-domains/menu?siteId=${encodeURIComponent(currentSiteId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((json) => {
        if (!Array.isArray(json?.items)) {
          setDataDomainTabs([]);
          return;
        }
        setDataDomainTabs(
          json.items.map((item: any) => ({
            name: item.label,
            href: item.href,
          })),
        );
      })
      .catch(() => setDataDomainTabs([]));
  }, [currentSiteId]);

  useEffect(() => {
    const query = currentSiteId ? `?siteId=${encodeURIComponent(currentSiteId)}` : "";
    fetch(`/api/plugins/admin-ui${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return;
        setHasAnalyticsProviders(Boolean(json.hasAnalyticsProviders));
        setEnvironmentBadge({
          show: Boolean(json.environmentBadge?.show),
          label: String(json.environmentBadge?.label || ""),
          environment: json.environmentBadge?.environment === "development" ? "development" : "production",
        });
        setFloatingWidgets(
          Array.isArray(json.floatingWidgets)
            ? json.floatingWidgets
                .map((widget: any) => ({
                  id: String(widget?.id || ""),
                  title: String(widget?.title || ""),
                  content: String(widget?.content || ""),
                  position: "bottom-right" as const,
                }))
                .filter((widget: any) => widget.id && widget.content)
            : [],
        );
      })
      .catch(() => {
        setHasAnalyticsProviders(false);
        setEnvironmentBadge({
          show: false,
          label: "",
          environment: "production",
        });
        setFloatingWidgets([]);
      });
  }, [currentSiteId]);

  const tabs = useMemo(() => {
    const domainPostMatch = pathname?.match(
      /^\/site\/([^/]+)\/domain\/([^/]+)\/post\/([^/]+)(?:\/settings)?$/,
    );
    if (segments[0] === "site" && id && domainPostMatch) {
      const domainKey = domainPostMatch[2];
      const postId = domainPostMatch[3];
      const baseHref = `/site/${id}/domain/${domainKey}/post/${postId}`;
      return [
        {
          name: "Back to Entries",
          href: `/site/${id}/domain/${domainKey}`,
          icon: <ArrowLeft width={18} />,
        },
        {
          name: "Editor",
          href: baseHref,
          isActive: pathname === baseHref,
          icon: <Edit3 width={18} />,
        },
        {
          name: "Settings",
          href: `${baseHref}/settings`,
          isActive: pathname === `${baseHref}/settings`,
          icon: <Settings width={18} />,
        },
      ];
    }

    if (segments[0] === "site" && id) {
      const siteTabs = [
        {
          name: "Posts",
          href: `/site/${id}`,
          isActive: segments.length === 2,
          icon: <Newspaper width={18} />,
        },
        ...(hasAnalyticsProviders
          ? [
              {
                name: "Analytics",
                href: `/site/${id}/analytics`,
                isActive: segments.includes("analytics"),
                icon: <BarChart3 width={18} />,
              },
            ]
          : []),
        {
          name: "Settings",
          href: `/site/${id}/settings`,
          isActive: segments.includes("settings"),
          icon: <Settings width={18} />,
        },
        ...dataDomainTabs.map((item) => ({
          name: item.name,
          href: item.href,
          isActive: pathname?.includes(item.href),
          icon: <Globe width={18} />,
        })),
      ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

      return [
        { name: "Back to All Sites", href: "/sites", icon: <ArrowLeft width={18} /> },
        ...siteTabs,
      ];
    }

    if (segments[0] === "post" && id) {
      return [
        {
          name: "Back to All Posts",
          href: siteId ? `/site/${siteId}` : "/sites",
          icon: <ArrowLeft width={18} />,
        },
        {
          name: "Editor",
          href: `/post/${id}`,
          isActive: segments.length === 2,
          icon: <Edit3 width={18} />,
        },
        {
          name: "Settings",
          href: `/post/${id}/settings`,
          isActive: segments.includes("settings"),
          icon: <Settings width={18} />,
        },
      ];
    }

    return [
      {
        name: "Overview",
        href: "/",
        isActive: segments.length === 0,
        icon: <LayoutDashboard width={18} />,
      },
      {
        name: "Sites",
        href: "/sites",
        isActive: segments[0] === "sites",
        icon: <Globe width={18} />,
      },
      {
        name: "Settings",
        href: "/settings",
        isActive: segments[0] === "settings",
        icon: <Settings width={18} />,
      },
      ...pluginTabs.map((item) => ({
        name: item.name,
        href: item.href,
        isActive: segments[0] === "plugins" && pathname?.includes(item.href),
        icon: <Settings width={18} />,
      })),
    ];
  }, [segments, id, siteId, pluginTabs, pathname, dataDomainTabs, hasAnalyticsProviders]);

  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    setShowSidebar(false);
  }, [pathname]);

  return (
    <>
      <button
        className={`fixed z-20 ${
          segments[0] === "post" && segments.length === 2 && !showSidebar
            ? "left-5 top-5"
            : "right-5 top-7"
        } sm:hidden`}
        onClick={() => setShowSidebar(!showSidebar)}
      >
        <Menu width={20} />
      </button>
      <div
        className={`transform ${
          showSidebar ? "w-full translate-x-0" : "-translate-x-full"
        } fixed z-10 flex h-full flex-col justify-between border-r border-stone-200 bg-stone-100 p-4 transition-all sm:w-60 sm:translate-x-0 dark:border-stone-700 dark:bg-stone-900`}
      >
        <div className="grid gap-2">
          <div className="rounded-lg px-2 py-1.5">
            <div className="flex items-center space-x-2">
              <a
                href={tootyHomeHref}
                className="rounded-lg p-1 hover:bg-stone-200 dark:hover:bg-stone-700"
              >
                <Image
                  src="/tooty/sprites/tooty-thumbs-up-cropped.png"
                  width={60}
                  height={60}
                  alt="Tooty CMS"
                  unoptimized
                  className="h-[3.75rem] w-[3.75rem] object-contain"
                />
              </a>
              <div className="h-6 rotate-[30deg] border-l border-stone-400 dark:border-stone-500" />
              <Link
                href="/"
                className="rounded-lg p-2 hover:bg-stone-200 dark:hover:bg-stone-700"
                title={
                  process.env.NODE_ENV === "development"
                    ? "Development environment (D)"
                    : "Production environment (P)"
                }
                aria-label={
                  process.env.NODE_ENV === "development"
                    ? "Development environment icon"
                    : "Production environment icon"
                }
              >
                <svg
                  width="26"
                  viewBox="0 0 76 65"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={`${
                    process.env.NODE_ENV === "development"
                      ? "text-red-500"
                      : "text-black dark:text-white"
                  }`}
                >
                  <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor" />
                  <text
                    x="50%"
                    y="58%"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fontSize="20"
                    fontWeight="bold"
                    fill="black"
                  >
                    {process.env.NODE_ENV === "development" ? "D" : "P"}
                  </text>
                </svg>
                <span className="sr-only">
                  {process.env.NODE_ENV === "development"
                    ? "Development environment"
                    : "Production environment"}
                </span>
              </Link>
            </div>
            {environmentBadge.show && environmentBadge.label ? (
              <div
                className={`mt-2 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] ${
                  environmentBadge.environment === "development"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                }`}
              >
                {environmentBadge.label}
              </div>
            ) : null}
          </div>
          <div className="grid gap-1">
            {tabs.map(({ name, href, isActive, icon }) => (
              <Link
                key={name}
                href={href}
                className={`flex items-center space-x-3 ${
                  isActive ? "bg-stone-200 text-black dark:bg-stone-700" : ""
                } rounded-lg px-2 py-1.5 transition-all duration-150 ease-in-out hover:bg-stone-200 active:bg-stone-300 dark:text-white dark:hover:bg-stone-700 dark:active:bg-stone-800`}
              >
                {icon}
                <span className="text-sm font-medium">{name}</span>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="grid gap-1">
            {externalLinks.map(({ name, href, icon }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-all duration-150 ease-in-out hover:bg-stone-200 active:bg-stone-300 dark:text-white dark:hover:bg-stone-700 dark:active:bg-stone-800"
              >
                <div className="flex items-center space-x-3">
                  {icon}
                  <span className="text-sm font-medium">{name}</span>
                </div>
                <p>↗</p>
              </a>
            ))}
          </div>
          <div className="my-2 border-t border-stone-200 dark:border-stone-700" />
          {children}
        </div>
      </div>
      {floatingWidgets
        .filter((widget) => widget.position === "bottom-right")
        .map((widget, idx) => (
          <div
            key={widget.id}
            className="pointer-events-none fixed right-4 z-20 max-w-xs rounded-lg border border-stone-300 bg-white/95 px-3 py-2 text-xs text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-200"
            style={{ bottom: `${1 + idx * 5.5}rem` }}
          >
            <p className="font-semibold">{widget.title || "Plugin Widget"}</p>
            <p className="mt-1 italic">"{widget.content}"</p>
          </div>
        ))}
    </>
  );
}
