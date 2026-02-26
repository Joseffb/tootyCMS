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
  User,
} from "lucide-react";
import { useParams, usePathname, useSelectedLayoutSegments } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { getSitePublicUrl } from "@/lib/site-url";

const externalLinks: any[] = [];
type NavTab = {
  name: string;
  href: string;
  isActive?: boolean;
  icon: ReactNode;
  isChild?: boolean;
  childLevel?: 1 | 2;
};

const GLOBAL_SETTINGS_TABS: Array<{ name: string; href: string; match: string }> = [
  { name: "Sites", href: "/settings/sites", match: "/settings/sites" },
  { name: "Themes", href: "/settings/themes", match: "/settings/themes" },
  { name: "Plugins", href: "/settings/plugins", match: "/settings/plugins" },
  { name: "Messages", href: "/settings/messages", match: "/settings/messages" },
  { name: "Database", href: "/settings/database", match: "/settings/database" },
  { name: "Schedules", href: "/settings/schedules", match: "/settings/schedules" },
  { name: "Users", href: "/settings/users", match: "/settings/users" },
  { name: "User Roles", href: "/settings/rbac", match: "/settings/rbac" },
];

export default function Nav({ children }: { children: ReactNode }) {
  const tootyHomeHref = getSitePublicUrl({ isPrimary: true, subdomain: "main" });
  const segments = useSelectedLayoutSegments();
  const { id } = useParams() as { id?: string };
  const pathname = usePathname();

  const [pluginTabs, setPluginTabs] = useState<Array<{ name: string; href: string }>>([]);
  const [dataDomainTabs, setDataDomainTabs] = useState<
    Array<{ name: string; singular: string; listHref: string; addHref: string; order?: number }>
  >([]);
  const [navContext, setNavContext] = useState<{
    siteCount: number;
    mainSiteId: string | null;
    migrationRequired: boolean;
    canManageNetworkSettings: boolean;
    canManageNetworkPlugins: boolean;
    canManageSiteSettings: boolean;
    canReadSiteAnalytics: boolean;
    canCreateSiteContent: boolean;
    sites: Array<{ id: string; name: string }>;
  }>({
    siteCount: 0,
    mainSiteId: null,
    migrationRequired: false,
    canManageNetworkSettings: false,
    canManageNetworkPlugins: false,
    canManageSiteSettings: false,
    canReadSiteAnalytics: false,
    canCreateSiteContent: false,
    sites: [],
  });
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
  const [teetyAnimatedQuote, setTeetyAnimatedQuote] = useState("");
  const [teetyAnimationPhase, setTeetyAnimationPhase] = useState<"dots" | "typing" | "done">("done");
  const [teetyImageLoaded, setTeetyImageLoaded] = useState(false);
  const [teetyAnimationRun, setTeetyAnimationRun] = useState(0);
  const adminUiRequestRef = useRef(0);
  const currentSiteId = segments[0] === "site" && id ? id : null;
  const singleSiteMode = navContext.siteCount === 1 && Boolean(navContext.mainSiteId);
  const effectiveSiteId = currentSiteId || (singleSiteMode ? navContext.mainSiteId : null);
  const teetyQuote = useMemo(
    () => floatingWidgets.find((widget) => widget.id === "hello-teety-quote")?.content || "",
    [floatingWidgets],
  );

  useEffect(() => {
    const query = !singleSiteMode && effectiveSiteId ? `?siteId=${encodeURIComponent(effectiveSiteId)}` : "";
    fetch(`/api/plugins/menu${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((json) => {
        if (!Array.isArray(json?.items)) {
          setPluginTabs([]);
          return;
        }
        setPluginTabs(
          json.items
            .map((item: any) => ({
              name: String(item.label || ""),
              href: String(item.href || ""),
              order: Number.isFinite(Number(item.order)) ? Number(item.order) : 999,
            }))
            .filter((item: any) => item.name && item.href)
            .sort((a: any, b: any) => (a.order - b.order) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
            .map((item: any) => ({
              name: item.name,
              href: item.href,
            })),
        );
      })
      .catch(() => setPluginTabs([]));
  }, [effectiveSiteId, singleSiteMode]);

  useEffect(() => {
    const querySiteId = segments[0] === "site" && id ? id : navContext.mainSiteId || "";
    const query = querySiteId ? `?siteId=${encodeURIComponent(querySiteId)}` : "";
    fetch(`/api/nav/context${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { siteCount: 0, mainSiteId: null, sites: [] }))
      .then((json) => {
        setNavContext({
          siteCount: Number(json?.siteCount || 0),
          mainSiteId: json?.mainSiteId ? String(json.mainSiteId) : null,
          migrationRequired: Boolean(json?.migrationRequired),
          canManageNetworkSettings: Boolean(json?.canManageNetworkSettings),
          canManageNetworkPlugins: Boolean(json?.canManageNetworkPlugins),
          canManageSiteSettings: Boolean(json?.canManageSiteSettings),
          canReadSiteAnalytics: Boolean(json?.canReadSiteAnalytics),
          canCreateSiteContent: Boolean(json?.canCreateSiteContent),
          sites: Array.isArray(json?.sites)
            ? json.sites
                .map((site: any) => ({
                  id: String(site?.id || ""),
                  name: String(site?.name || ""),
                }))
                .filter((site: { id: string; name: string }) => site.id)
            : [],
        });
      })
      .catch(() =>
        setNavContext({
          siteCount: 0,
          mainSiteId: null,
          migrationRequired: false,
          canManageNetworkSettings: false,
          canManageNetworkPlugins: false,
          canManageSiteSettings: false,
          canReadSiteAnalytics: false,
          canCreateSiteContent: false,
          sites: [],
        }),
      );
  }, [pathname, id, navContext.mainSiteId]);

  useEffect(() => {
    if (!effectiveSiteId) {
      setDataDomainTabs([]);
      return;
    }
    fetch(`/api/data-domains/menu?siteId=${encodeURIComponent(effectiveSiteId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((json) => {
        if (!Array.isArray(json?.items)) {
          setDataDomainTabs([]);
          return;
        }
        setDataDomainTabs(
          json.items
            .map((item: any) => ({
              name: String(item.label || ""),
              singular: String(item.singular || ""),
              listHref: String(item.listHref || ""),
              addHref: String(item.addHref || ""),
              order: Number.isFinite(Number(item.order)) ? Number(item.order) : undefined,
            }))
            .filter((item: any) => item.name && item.listHref && item.addHref),
        );
      })
      .catch(() => setDataDomainTabs([]));
  }, [effectiveSiteId]);

  useEffect(() => {
    const query = effectiveSiteId ? `?siteId=${encodeURIComponent(effectiveSiteId)}` : "";
    const separator = query ? "&" : "?";
    const requestId = ++adminUiRequestRef.current;
    const controller = new AbortController();
    fetch(`/api/plugins/admin-ui${query}${separator}r=${Date.now()}`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (controller.signal.aborted || requestId !== adminUiRequestRef.current) return;
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
        setTeetyAnimationRun((value) => value + 1);
      })
      .catch(() => {
        if (controller.signal.aborted || requestId !== adminUiRequestRef.current) return;
        setHasAnalyticsProviders(false);
        setEnvironmentBadge({
          show: false,
          label: "",
          environment: "production",
        });
        setFloatingWidgets([]);
        setTeetyAnimationRun((value) => value + 1);
      });
    return () => {
      controller.abort();
    };
  }, [effectiveSiteId, pathname]);

  useEffect(() => {
    if (!teetyQuote) {
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
      setTeetyAnimatedQuote(teetyQuote.slice(0, idx));
      if (idx < teetyQuote.length) {
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
  }, [teetyQuote, teetyImageLoaded, teetyAnimationRun]);

  const globalSettingsWithChildren = useMemo<NavTab[]>(() => {
    const parent: NavTab = {
      name: "Settings",
      href: "/settings",
      isActive: segments[0] === "settings",
      icon: <Globe width={18} />,
    };
    const filteredTabs = GLOBAL_SETTINGS_TABS.filter((item) => {
      if (singleSiteMode && item.name === "Sites") return false;
      if (!navContext.migrationRequired && item.name === "Database") return false;
      if (!navContext.canManageNetworkPlugins && item.name === "Messages") return false;
      return true;
    });
    const settingsChildren: NavTab[] = filteredTabs.flatMap((item) => {
      const base: NavTab = {
        name: item.name,
        href: item.href,
        isActive: pathname?.includes(item.match),
        icon: <Settings width={18} />,
        isChild: true,
        childLevel: 1 as const,
      };
      if (item.name !== "Plugins") return [base];
      const pluginChildren: NavTab[] = pluginTabs.map((plugin) => ({
        name: plugin.name,
        href: plugin.href,
        isActive: pathname?.includes(plugin.href),
        icon: <Settings width={18} />,
        isChild: true,
        childLevel: 2 as const,
      }));
      return [base, ...pluginChildren];
    });
    return [parent, ...settingsChildren];
  }, [pathname, pluginTabs, segments, singleSiteMode, navContext.migrationRequired, navContext.canManageNetworkPlugins]);

  const tabs = useMemo<NavTab[]>(() => {
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
          icon: <Monitor width={18} />,
        },
      ];
    }

    const buildContentTabs = (siteId: string): NavTab[] => {
      const entries = [
        {
          name: "Posts",
          singular: "Post",
          listHref: `/site/${siteId}/domain/post`,
          addHref: `/site/${siteId}/domain/post/create`,
          order: undefined as number | undefined,
        },
        ...dataDomainTabs,
      ]
        .sort((a, b) => {
          const aHasOrder = Number.isFinite(a.order);
          const bHasOrder = Number.isFinite(b.order);
          if (aHasOrder && bHasOrder) return Number(a.order) - Number(b.order);
          if (aHasOrder) return -1;
          if (bHasOrder) return 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });

      return entries.flatMap((item) => ([
        {
          name: item.name,
          href: item.listHref,
          isActive: pathname?.includes(item.listHref) && !pathname?.includes(`${item.listHref}/create`),
          icon: <Globe width={18} />,
        },
        {
          name: `List ${item.name}`,
          href: item.listHref,
          isActive: pathname?.includes(item.listHref) && !pathname?.includes(`${item.listHref}/create`),
          icon: <Globe width={18} />,
          isChild: true as const,
          childLevel: 1 as const,
        },
        {
          name: `Add ${item.singular}`,
          href: item.addHref,
          isActive: pathname?.includes(item.addHref),
          icon: <Globe width={18} />,
          isChild: true as const,
          childLevel: 1 as const,
        },
      ]));
    };

    if (segments[0] === "site" && id) {
      const siteSettingsChildren: NavTab[] = [
        { name: "General", href: `/site/${id}/settings`, match: `/site/${id}/settings` },
        { name: "Categories", href: `/site/${id}/settings/categories`, match: `/site/${id}/settings/categories` },
        { name: "Post-Types", href: `/site/${id}/settings/domains`, match: `/site/${id}/settings/domains` },
        { name: "Reading", href: `/site/${id}/settings/reading`, match: `/site/${id}/settings/reading` },
        { name: "SEO & Social", href: `/site/${id}/settings/seo`, match: `/site/${id}/settings/seo` },
        { name: "Writing", href: `/site/${id}/settings/writing`, match: `/site/${id}/settings/writing` },
        { name: "Menus", href: `/site/${id}/settings/menus`, match: `/site/${id}/settings/menus` },
        { name: "Themes", href: `/site/${id}/settings/themes`, match: `/site/${id}/settings/themes` },
        {
          name: "Plugins",
          href: `/site/${id}/settings/plugins`,
          match: `/site/${id}/settings/plugins`,
        },
        {
          name: "Messages",
          href: `/site/${id}/settings/messages`,
          match: `/site/${id}/settings/messages`,
        },
        {
          name: "Users",
          href: `/site/${id}/settings/users`,
          match: `/site/${id}/settings/users`,
        },
      ].flatMap((item) => {
        const base: NavTab = {
          name: item.name,
          href: item.href,
          isActive: pathname?.includes(item.match),
          icon: <Settings width={18} />,
          isChild: true as const,
          childLevel: 1 as const,
        };
        if (item.name !== "Plugins") return [base];
        const pluginChildren: NavTab[] = pluginTabs.map((plugin) => ({
          name: plugin.name,
          href: plugin.href,
          isActive: pathname?.includes(plugin.href),
          icon: <Settings width={18} />,
          isChild: true,
          childLevel: 2 as const,
        }));
        return [base, ...pluginChildren];
      });

      const siteTabs: NavTab[] = [
        {
          name: "Profile",
          href: "/profile",
          isActive: pathname?.startsWith("/profile"),
          icon: <User width={18} />,
        },
        ...(navContext.canCreateSiteContent ? buildContentTabs(id) : []),
        ...(hasAnalyticsProviders && navContext.canReadSiteAnalytics
          ? [
              {
                name: "Analytics",
                href: `/site/${id}/analytics`,
                isActive: segments.includes("analytics"),
                icon: <BarChart3 width={18} />,
              },
            ]
          : []),
        ...(navContext.canManageSiteSettings
          ? [
              {
                name: "Settings",
                href: `/site/${id}/settings`,
                isActive: segments.includes("settings"),
                icon: <Monitor width={18} />,
              },
              ...siteSettingsChildren,
            ]
          : []),
      ];

      return singleSiteMode
        ? siteTabs
        : [{ name: "Back to All Sites", href: "/sites", icon: <ArrowLeft width={18} /> }, ...siteTabs];
    }

    if (singleSiteMode && navContext.mainSiteId) {
      const singleSiteTabs: NavTab[] = [
        {
          name: "Profile",
          href: "/profile",
          isActive: pathname?.startsWith("/profile"),
          icon: <User width={18} />,
        },
        ...(navContext.canCreateSiteContent ? buildContentTabs(navContext.mainSiteId) : []),
        ...(hasAnalyticsProviders && navContext.canReadSiteAnalytics
          ? [
              {
                name: "Analytics",
                href: `/site/${navContext.mainSiteId}/analytics`,
                isActive: pathname?.includes(`/site/${navContext.mainSiteId}/analytics`),
                icon: <BarChart3 width={18} />,
              } as NavTab,
            ]
          : []),
        ...(navContext.canManageSiteSettings
          ? [
              {
                name: "System",
                href: `/site/${navContext.mainSiteId}/settings`,
                isActive: pathname?.includes(`/site/${navContext.mainSiteId}/settings`),
                icon: <Monitor width={18} />,
              },
              ...[
          { name: "General", href: `/site/${navContext.mainSiteId}/settings`, match: `/site/${navContext.mainSiteId}/settings` },
          { name: "Categories", href: `/site/${navContext.mainSiteId}/settings/categories`, match: `/site/${navContext.mainSiteId}/settings/categories` },
          { name: "Post-Types", href: `/site/${navContext.mainSiteId}/settings/domains`, match: `/site/${navContext.mainSiteId}/settings/domains` },
          { name: "Reading", href: `/site/${navContext.mainSiteId}/settings/reading`, match: `/site/${navContext.mainSiteId}/settings/reading` },
          { name: "SEO & Social", href: `/site/${navContext.mainSiteId}/settings/seo`, match: `/site/${navContext.mainSiteId}/settings/seo` },
          { name: "Writing", href: `/site/${navContext.mainSiteId}/settings/writing`, match: `/site/${navContext.mainSiteId}/settings/writing` },
          { name: "Menus", href: `/site/${navContext.mainSiteId}/settings/menus`, match: `/site/${navContext.mainSiteId}/settings/menus` },
          { name: "Themes", href: `/site/${navContext.mainSiteId}/settings/themes`, match: `/site/${navContext.mainSiteId}/settings/themes` },
          { name: "Plugins", href: `/site/${navContext.mainSiteId}/settings/plugins`, match: `/site/${navContext.mainSiteId}/settings/plugins` },
          { name: "Messages", href: `/site/${navContext.mainSiteId}/settings/messages`, match: `/site/${navContext.mainSiteId}/settings/messages` },
          { name: "Users", href: `/site/${navContext.mainSiteId}/settings/users`, match: `/site/${navContext.mainSiteId}/settings/users` },
          { name: "Database", href: `/site/${navContext.mainSiteId}/settings/database`, match: `/site/${navContext.mainSiteId}/settings/database` },
          { name: "RBAC", href: `/site/${navContext.mainSiteId}/settings/rbac`, match: `/site/${navContext.mainSiteId}/settings/rbac` },
          { name: "Schedules", href: `/site/${navContext.mainSiteId}/settings/schedules`, match: `/site/${navContext.mainSiteId}/settings/schedules` },
        ].flatMap((item) => {
          const base: NavTab = {
            name: item.name,
            href: item.href,
            isActive: pathname?.includes(item.match),
            icon: <Settings width={18} />,
            isChild: true as const,
            childLevel: 1 as const,
          };
          if (item.name !== "Plugins") return [base];
          const pluginChildren: NavTab[] = pluginTabs.map((plugin) => ({
            name: plugin.name,
            href: plugin.href,
            isActive: pathname?.includes(plugin.href),
            icon: <Settings width={18} />,
            isChild: true,
            childLevel: 2 as const,
          }));
          return [base, ...pluginChildren];
        }),
            ]
          : []),
        ...(navContext.canManageNetworkSettings ? globalSettingsWithChildren : []),
      ];
      return singleSiteTabs;
    }

    return [
      {
        name: "Profile",
        href: "/profile",
        isActive: pathname?.startsWith("/profile"),
        icon: <User width={18} />,
      },
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
      ...[...navContext.sites]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
        .map((site) => ({
        name: site.name,
        href: `/site/${site.id}`,
        isActive: pathname?.includes(`/site/${site.id}`),
        icon: <Globe width={18} />,
        isChild: true,
        childLevel: 1 as const,
      })),
      ...(navContext.canManageNetworkSettings ? globalSettingsWithChildren : []),
    ];
  }, [segments, id, pathname, dataDomainTabs, hasAnalyticsProviders, navContext.mainSiteId, navContext.sites, navContext.canManageNetworkSettings, navContext.canManageSiteSettings, navContext.canReadSiteAnalytics, navContext.canCreateSiteContent, singleSiteMode, pluginTabs, globalSettingsWithChildren]);

  const [showSidebar, setShowSidebar] = useState(false);
  const [collapsedByHref, setCollapsedByHref] = useState<Record<string, boolean>>({});

  const renderedTabs = useMemo(() => {
    let currentLevel0Href: string | null = null;
    let currentLevel1Href: string | null = null;

    return tabs.map((tab, idx) => {
      const level = tab.childLevel ?? 0;
      if (level === 0) {
        currentLevel0Href = tab.href;
        currentLevel1Href = null;
      } else if (level === 1) {
        currentLevel1Href = tab.href;
      }

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
        ...tab,
        level,
        hasChildren,
        visible,
      };
    });
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
                  <span className="mt-0.5">{icon}</span>
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
        .filter((widget) => widget.position === "bottom-right")
        .map((widget, idx) => (
          (() => {
            const isTeety = widget.id === "hello-teety-quote";
            const bottom = `${1 + idx * 5.5}rem`;
            return (
              <div key={widget.id} className="pointer-events-none fixed right-4 z-20 max-w-xs" style={{ bottom }}>
                {isTeety ? (
                  <div className="relative overflow-visible rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 pr-14 text-xs text-stone-100 shadow-lg">
                    <p className="italic">
                      {teetyImageLoaded ? (teetyAnimatedQuote || (teetyAnimationPhase === "done" ? widget.content : "")) : ""}
                      {teetyAnimationPhase === "typing" && teetyAnimatedQuote.length < widget.content.length ? <span className="ml-0.5 animate-pulse">|</span> : null}
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
                  <div className="rounded-lg border border-stone-300 bg-white/95 px-3 py-2 text-xs text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-200">
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
