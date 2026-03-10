"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Edit3,
  Globe,
  LayoutDashboard,
  Menu,
  Monitor,
  Settings,
  X,
  User,
} from "lucide-react";
import { useParams, usePathname, useSelectedLayoutSegments } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  buildSidebarTabs,
  type AdminNavContext,
  type AdminSidebarIcon,
} from "@/lib/admin-nav";
import { getSitePublicUrl } from "@/lib/site-url";
import { getDomainPostAdminItemPath, getDomainPostAdminListPath } from "@/lib/domain-post-admin-routes";

const externalLinks: any[] = [];
type NavTab = {
  name: string;
  href: string;
  isActive?: boolean;
  icon: AdminSidebarIcon;
  isChild?: boolean;
  childLevel?: 1 | 2;
};

type FloatingWidget = {
  id: string;
  title: string;
  content: string;
  position: "top-right" | "bottom-right";
  dismissSetting?: {
    pluginId: string;
    key: string;
    value: unknown;
  };
};

const FLOATING_WIDGET_DISMISS_KEY = "tooty:floating-widgets:dismissed:v1";

function buildFloatingWidgetDismissKey(widget: FloatingWidget) {
  return `${widget.id}::${widget.content}`;
}

function normalizeAdminSiteHref(href: string) {
  if (!href) return href;
  return href.startsWith("/site/") ? href.replace(/^\/site\//, "/app/site/") : href;
}

function parsePluginTabs(items: any[]): { settings: Array<{ name: string; href: string }>; root: Array<{ name: string; href: string }> } {
  if (!Array.isArray(items)) {
    return { settings: [], root: [] };
  }
  const normalized = items
    .map((item: any) => ({
      name: String(item.label || ""),
      href: String(item.href || ""),
      placement: item?.placement === "root" ? "root" : "settings",
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 999,
    }))
    .filter((item: any) => item.name && item.href)
    .sort((a: any, b: any) => (a.order - b.order) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const toTabs = (placement: "settings" | "root") =>
    normalized
      .filter((item: any) => item.placement === placement)
      .map((item: any) => ({
      name: item.name,
      href: item.href,
      }));
  return {
    settings: toTabs("settings"),
    root: toTabs("root"),
  };
}

function parseDataDomainTabs(items: any[]): Array<{ name: string; singular: string; listHref: string; addHref: string; order?: number }> {
  if (!Array.isArray(items)) return [];
  return items
    .map((item: any) => ({
      name: String(item.label || ""),
      singular: String(item.singular || ""),
      listHref: normalizeAdminSiteHref(String(item.listHref || "")),
      addHref: normalizeAdminSiteHref(String(item.addHref || "")),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : undefined,
    }))
    .filter((item: any) => item.name && item.listHref && item.addHref);
}

const EMPTY_NAV_CONTEXT: AdminNavContext = {
  siteCount: 0,
  mainSiteId: null,
  effectiveSiteId: null,
  adminMode: "multi-site",
  activeScope: "network",
  migrationRequired: false,
  canManageNetworkSettings: false,
  canManageNetworkPlugins: false,
  canManageSiteSettings: false,
  canReadSiteAnalytics: false,
  canCreateSiteContent: false,
  sites: [],
};

function renderNavIcon(icon: AdminSidebarIcon) {
  switch (icon) {
    case "back":
      return <ArrowLeft width={18} />;
    case "analytics":
      return <BarChart3 width={18} />;
    case "dashboard":
      return <LayoutDashboard width={18} />;
    case "network-settings":
      return <Globe width={18} />;
    case "plugin":
      return <Edit3 width={18} />;
    case "profile":
      return <User width={18} />;
    case "site":
    case "content":
      return <Globe width={18} />;
    case "site-settings":
      return <Monitor width={18} />;
    default:
      return <Settings width={18} />;
  }
}

export default function Nav({ children }: { children: ReactNode }) {
  const tootyHomeHref = getSitePublicUrl({ isPrimary: true, subdomain: "main" });
  const segments = useSelectedLayoutSegments();
  const { id } = useParams() as { id?: string };
  const pathname = usePathname();

  const [pluginTabs, setPluginTabs] = useState<Array<{ name: string; href: string }>>([]);
  const [rootPluginTabs, setRootPluginTabs] = useState<Array<{ name: string; href: string }>>([]);
  const [dataDomainTabs, setDataDomainTabs] = useState<
    Array<{ name: string; singular: string; listHref: string; addHref: string; order?: number }>
  >([]);
  const [navContext, setNavContext] = useState<AdminNavContext>(EMPTY_NAV_CONTEXT);
  const [environmentBadge, setEnvironmentBadge] = useState<{
    show: boolean;
    label: string;
    environment: "development" | "production";
  }>({
    show: false,
    label: "",
    environment: "production",
  });
  const [floatingWidgets, setFloatingWidgets] = useState<FloatingWidget[]>([]);
  const [dismissedFloatingWidgets, setDismissedFloatingWidgets] = useState<Set<string>>(new Set());
  const [hasAnalyticsProviders, setHasAnalyticsProviders] = useState(false);
  const [teetyAnimatedQuote, setTeetyAnimatedQuote] = useState("");
  const [teetyAnimationPhase, setTeetyAnimationPhase] = useState<"dots" | "typing" | "done">("done");
  const [teetyImageLoaded, setTeetyImageLoaded] = useState(false);
  const [teetyAnimationRun, setTeetyAnimationRun] = useState(0);
  const adminUiRequestRef = useRef(0);
  const currentSiteId = segments[0] === "site" && id ? id : null;
  const effectiveSiteId = navContext.effectiveSiteId || currentSiteId || navContext.mainSiteId;
  const teetyQuote = useMemo(
    () => floatingWidgets.find((widget) => widget.id === "hello-teety-quote")?.content || "",
    [floatingWidgets],
  );
  const teetyDisplayQuote = useMemo(() => {
    const normalizeLine = (line: string) =>
      String(line || "")
        .replace(/^\s*(?:[-*•]\s+|\d+\.\s+)/, "")
        .trim();
    const lines = String(teetyQuote || "")
      .split(/\r?\n/)
      .map((line) => normalizeLine(line))
      .filter(Boolean);
    if (lines.length <= 1) return lines[0] || "";
    const index = Math.abs(teetyAnimationRun % lines.length);
    return lines[index] || lines[0] || "";
  }, [teetyQuote, teetyAnimationRun]);
  const teetyDisplayQuoteStyled = useMemo(() => {
    const trimmed = String(teetyDisplayQuote || "")
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    return trimmed ? `“${trimmed}”` : "";
  }, [teetyDisplayQuote]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(FLOATING_WIDGET_DISMISS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const keys = parsed.map((value: any) => String(value || "").trim()).filter(Boolean);
      setDismissedFloatingWidgets(new Set(keys));
    } catch {
      setDismissedFloatingWidgets(new Set());
    }
  }, []);

  const loadPluginTabs = useCallback(() => {
      const query = effectiveSiteId ? `?siteId=${encodeURIComponent(effectiveSiteId)}` : "";
    fetch(`/api/plugins/menu${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((json) => {
        const parsed = parsePluginTabs(json?.items);
        setPluginTabs(parsed.settings);
        setRootPluginTabs(parsed.root);
      })
      .catch(() => {
        setPluginTabs([]);
        setRootPluginTabs([]);
      });
  }, [effectiveSiteId]);

  useEffect(() => {
    const onPluginSettingsPage = pathname?.includes("/settings/plugins");
    if (!onPluginSettingsPage) return;
    loadPluginTabs();
    const timer = setInterval(() => loadPluginTabs(), 1500);
    return () => clearInterval(timer);
  }, [loadPluginTabs, pathname]);

  useEffect(() => {
    const querySiteId = currentSiteId || "";
    const siteQuery = querySiteId ? `siteId=${encodeURIComponent(querySiteId)}&` : "";
    const pathQuery = `path=${encodeURIComponent(pathname || "")}`;
    const requestId = ++adminUiRequestRef.current;
    const controller = new AbortController();
    fetch(`/api/admin/bootstrap?${siteQuery}${pathQuery}`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (controller.signal.aborted || requestId !== adminUiRequestRef.current) return;
        if (!json) return;
        const nextNavContext = json?.navContext || {};
        setNavContext({
          siteCount: Number(nextNavContext?.siteCount || 0),
          mainSiteId: nextNavContext?.mainSiteId ? String(nextNavContext.mainSiteId) : null,
          effectiveSiteId: nextNavContext?.effectiveSiteId ? String(nextNavContext.effectiveSiteId) : null,
          adminMode: nextNavContext?.adminMode === "single-site" ? "single-site" : "multi-site",
          activeScope:
            nextNavContext?.activeScope === "site"
              ? "site"
              : nextNavContext?.activeScope === "merged-single-site"
                ? "merged-single-site"
                : "network",
          migrationRequired: Boolean(nextNavContext?.migrationRequired),
          canManageNetworkSettings: Boolean(nextNavContext?.canManageNetworkSettings),
          canManageNetworkPlugins: Boolean(nextNavContext?.canManageNetworkPlugins),
          canManageSiteSettings: Boolean(nextNavContext?.canManageSiteSettings),
          canReadSiteAnalytics: Boolean(nextNavContext?.canReadSiteAnalytics),
          canCreateSiteContent: Boolean(nextNavContext?.canCreateSiteContent),
          sites: Array.isArray(nextNavContext?.sites)
            ? nextNavContext.sites
                .map((site: any) => ({
                  id: String(site?.id || ""),
                  name: String(site?.name || ""),
                }))
                .filter((site: { id: string; name: string }) => site.id)
            : [],
        });
        const parsedPluginTabs = parsePluginTabs(json?.pluginMenuItems);
        setPluginTabs(parsedPluginTabs.settings);
        setRootPluginTabs(parsedPluginTabs.root);
        setDataDomainTabs(parseDataDomainTabs(json?.dataDomainItems));
        const adminUi = json?.adminUi || {};
        setHasAnalyticsProviders(Boolean(adminUi.hasAnalyticsProviders));
        setEnvironmentBadge({
          show: Boolean(adminUi.environmentBadge?.show),
          label: String(adminUi.environmentBadge?.label || ""),
          environment: adminUi.environmentBadge?.environment === "development" ? "development" : "production",
        });
        setFloatingWidgets(
          Array.isArray(adminUi.floatingWidgets)
            ? adminUi.floatingWidgets
                .map((widget: any) => ({
                  id: String(widget?.id || ""),
                  title: String(widget?.title || ""),
                  content: String(widget?.content || ""),
                  position: widget?.position === "top-right" ? ("top-right" as const) : ("bottom-right" as const),
                  dismissSetting:
                    widget?.dismissSetting &&
                    String(widget.dismissSetting.pluginId || "").trim() &&
                    String(widget.dismissSetting.key || "").trim()
                      ? {
                          pluginId: String(widget.dismissSetting.pluginId || "").trim(),
                          key: String(widget.dismissSetting.key || "").trim(),
                          value: widget.dismissSetting.value,
                        }
                      : undefined,
                }))
                .filter((widget: any) => widget.id && widget.content)
            : [],
        );
        setTeetyAnimationRun((value) => value + 1);
      })
      .catch(() => {
        if (controller.signal.aborted || requestId !== adminUiRequestRef.current) return;
        setNavContext(EMPTY_NAV_CONTEXT);
        setPluginTabs([]);
        setDataDomainTabs([]);
        setHasAnalyticsProviders(false);
        setEnvironmentBadge({
          show: false,
          label: "",
          environment: "production",
        });
        setFloatingWidgets([]);
        setTeetyAnimationRun((value) => value + 1);
      });
    return () => controller.abort();
  }, [currentSiteId, pathname]);

  const dismissFloatingWidget = useCallback((widget: FloatingWidget) => {
    if (widget.dismissSetting?.pluginId && widget.dismissSetting?.key) {
      fetch("/api/plugins/widget-dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pluginId: widget.dismissSetting.pluginId,
          key: widget.dismissSetting.key,
          value: widget.dismissSetting.value,
        }),
      }).catch(() => {
        // Keep UI responsive even if persistence fails.
      });
      setFloatingWidgets((prev) => prev.filter((item) => item.id !== widget.id));
      return;
    }
    const key = buildFloatingWidgetDismissKey(widget);
    setDismissedFloatingWidgets((prev) => {
      const next = new Set(prev);
      next.add(key);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(FLOATING_WIDGET_DISMISS_KEY, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!teetyDisplayQuoteStyled) {
      setTeetyAnimatedQuote("");
      setTeetyAnimationPhase("done");
      return;
    }
    if (!teetyImageLoaded) {
      setTeetyAnimatedQuote("");
      setTeetyAnimationPhase("done");
      return;
    }

    const dotFrames = [".", ". .", ". . ."];
    const totalDotCycles = 3;
    let dotStep = 0;
    let cycleCount = 0;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setTeetyAnimationPhase("dots");
    setTeetyAnimatedQuote(dotFrames[0]);

    const typeTick = () => {
      idx += 1;
      setTeetyAnimatedQuote(teetyDisplayQuoteStyled.slice(0, idx));
      if (idx < teetyDisplayQuoteStyled.length) {
        timer = setTimeout(typeTick, 50);
      } else {
        setTeetyAnimationPhase("done");
      }
    };

    const dotTick = () => {
      setTeetyAnimatedQuote(dotFrames[dotStep]);
      dotStep = (dotStep + 1) % dotFrames.length;
      if (dotStep === 0) cycleCount += 1;
      if (cycleCount < totalDotCycles) {
        timer = setTimeout(dotTick, 400);
        return;
      }
      setTeetyAnimationPhase("typing");
      setTeetyAnimatedQuote("");
      timer = setTimeout(typeTick, 90);
    };

    timer = setTimeout(dotTick, 120);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [teetyDisplayQuoteStyled, teetyImageLoaded, teetyAnimationRun]);

  const tabs = useMemo<NavTab[]>(() => {
    const domainPostMatch = pathname?.match(
      /^\/(?:app\/)?site\/([^/]+)\/domain\/([^/]+)\/(?:item|post)\/([^/]+)(?:\/settings)?$/,
    );
    if (segments[0] === "site" && id && domainPostMatch) {
      const domainKey = domainPostMatch[2];
      const postId = domainPostMatch[3];
      const baseHref = getDomainPostAdminItemPath(id, domainKey, postId);
      return [
        {
          name: "Back to Entries",
          href: getDomainPostAdminListPath(id, domainKey),
          icon: "back",
        },
        {
          name: "Editor",
          href: baseHref,
          isActive: pathname === baseHref,
          icon: "plugin",
        },
        {
          name: "Settings",
          href: `${baseHref}/settings`,
          isActive: pathname === `${baseHref}/settings`,
          icon: "site-settings",
        },
      ];
    }
    if (!pathname) return [];
    return buildSidebarTabs({
      pathname,
      navContext,
      currentSiteId,
      dataDomainTabs,
      hasAnalyticsProviders,
      pluginTabs,
      rootPluginTabs,
    });
  }, [currentSiteId, dataDomainTabs, hasAnalyticsProviders, id, navContext, pathname, pluginTabs, rootPluginTabs, segments]);

  const [showSidebar, setShowSidebar] = useState(false);
  const [collapsedByHref, setCollapsedByHref] = useState<Record<string, boolean>>({});

  const renderedTabs = useMemo(() => {
    return tabs.reduce<{
      items: Array<NavTab & { level: number; hasChildren: boolean; visible: boolean }>;
      currentLevel0Href: string | null;
      currentLevel1Href: string | null;
    }>(
      (state, tab, idx) => {
        const level = tab.childLevel ?? 0;
        const currentLevel0Href = level === 0 ? tab.href : state.currentLevel0Href;
        const currentLevel1Href = level === 1 ? tab.href : level === 0 ? null : state.currentLevel1Href;
        const nextLevel = tabs[idx + 1]?.childLevel ?? 0;
        const hasChildren = nextLevel > level;
        const level0Collapsed = currentLevel0Href ? (collapsedByHref[currentLevel0Href] ?? true) : false;
        const level1Collapsed = currentLevel1Href ? (collapsedByHref[currentLevel1Href] ?? true) : false;
        const visible =
          level === 0
            ? true
            : level === 1
              ? !level0Collapsed
              : !level0Collapsed && !level1Collapsed;

        return {
          currentLevel0Href,
          currentLevel1Href,
          items: [
            ...state.items,
            {
              ...tab,
              level,
              hasChildren,
              visible,
            },
          ],
        };
      },
      {
        items: [],
        currentLevel0Href: null,
        currentLevel1Href: null,
      },
    ).items;
  }, [tabs, collapsedByHref]);

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
        } fixed z-10 flex h-full min-h-0 flex-col justify-between overflow-hidden border-r border-stone-200 bg-stone-100 p-4 transition-all sm:w-60 sm:translate-x-0 dark:border-stone-700 dark:bg-stone-900 [&_a]:no-underline`}
      >
        <div className="grid min-h-0 flex-1 gap-2">
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
                href="/app"
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
          <div className="min-h-0 overflow-y-auto pr-1">
            <div className="grid gap-1 pb-2">
              {renderedTabs
                .filter((tab) => tab.visible)
                .map(({ name, href, isActive, icon, isChild, childLevel, hasChildren, level }) => (
                <Link
                  key={`${name}-${href}`}
                  href={href}
                  className={`flex items-start space-x-3 ${
                    isActive ? "bg-stone-200 text-black dark:bg-stone-700" : ""
                  } rounded-lg px-2 py-1.5 transition-all duration-150 ease-in-out hover:bg-stone-200 active:bg-stone-300 dark:text-white dark:hover:bg-stone-700 dark:active:bg-stone-800 ${
                    !isChild ? "" : childLevel === 2 ? "ml-10" : "ml-5"
                  }`}
                >
                  <span className="mt-0.5">{renderNavIcon(icon)}</span>
                  <span className="flex-1 text-sm font-medium leading-tight">{name}</span>
                  {hasChildren ? (
                    <button
                      type="button"
                      aria-label={`${collapsedByHref[href] ? "Expand" : "Collapse"} ${name}`}
                      className="mt-0.5 self-start rounded p-0.5 hover:bg-stone-300/50 dark:hover:bg-stone-600/50"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setCollapsedByHref((prev) => ({
                          ...prev,
                          [href]: !(prev[href] ?? true),
                        }));
                      }}
                    >
                      {(collapsedByHref[href] ?? true) ? <ChevronRight width={14} /> : <ChevronDown width={14} />}
                    </button>
                  ) : level > 0 ? (
                    <span className="inline-block w-[18px]" />
                  ) : null}
                </Link>
              ))}
            </div>
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
        .filter(
          (widget) =>
            widget.position === "top-right" &&
            (widget.dismissSetting ? true : !dismissedFloatingWidgets.has(buildFloatingWidgetDismissKey(widget))),
        )
        .map((widget, idx) => (
          (() => {
            const top = `${1 + idx * 5.5}rem`;
            return (
              <div key={widget.id} className="fixed right-4 z-30 max-w-xs" style={{ top }}>
                <div className="relative rounded-lg border border-stone-300 bg-white/95 px-3 py-2 pr-8 text-xs text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-200">
                  <button
                    type="button"
                    aria-label="Dismiss widget"
                    className="absolute right-1 top-1 rounded p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                    onClick={() => dismissFloatingWidget(widget)}
                  >
                    <X width={14} height={14} />
                  </button>
                  <p className="font-semibold">{widget.title || "Plugin Widget"}</p>
                  <p className="mt-1 italic">{widget.content}</p>
                </div>
              </div>
            );
          })()
        ))}
      {floatingWidgets
        .filter(
          (widget) =>
            widget.position === "bottom-right" &&
            (widget.dismissSetting ? true : !dismissedFloatingWidgets.has(buildFloatingWidgetDismissKey(widget))),
        )
        .map((widget, idx) => (
          (() => {
            const isTeety = widget.id === "hello-teety-quote";
            const bottom = `${1 + idx * 5.5}rem`;
            return (
              <div key={widget.id} className="fixed right-4 z-20 max-w-xs" style={{ bottom }}>
                {isTeety ? (
                  <div className="relative overflow-visible rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 pr-14 text-xs text-stone-100 shadow-lg">
                    <p className="whitespace-pre-line italic">
                      {teetyImageLoaded ? (teetyAnimatedQuote || (teetyAnimationPhase === "done" ? teetyDisplayQuoteStyled : "")) : ""}
                      {teetyAnimationPhase === "typing" && teetyAnimatedQuote.length < teetyDisplayQuoteStyled.length ? <span className="ml-0.5 animate-pulse">|</span> : null}
                    </p>
                    <Image
                      src="/plugin-assets/hello-teety/teety.png"
                      alt="Teety"
                      width={72}
                      height={72}
                      onLoadingComplete={() => setTeetyImageLoaded(true)}
                      unoptimized
                      className="absolute -bottom-4 -right-5 h-[72px] w-[72px] object-contain"
                    />
                  </div>
                ) : (
                  <div className="relative rounded-lg border border-stone-300 bg-white/95 px-3 py-2 pr-8 text-xs text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-200">
                    <button
                      type="button"
                      aria-label="Dismiss widget"
                      className="absolute right-1 top-1 rounded p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                      onClick={() => dismissFloatingWidget(widget)}
                    >
                      <X width={14} height={14} />
                    </button>
                    <p className="font-semibold">{widget.title || "Plugin Widget"}</p>
                    <p className="mt-1 italic">{widget.content}</p>
                  </div>
                )}
              </div>
            );
          })()
        ))}
    </>
  );
}
