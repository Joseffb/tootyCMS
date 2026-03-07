"use client";

import { cn } from "@/lib/utils";
import { buildGlobalSettingsNavItems } from "@/lib/admin-nav";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function GlobalSettingsNav() {
  const segment = useSelectedLayoutSegment();
  const [adminMode, setAdminMode] = useState<"single-site" | "multi-site">("multi-site");
  const [mainSiteId, setMainSiteId] = useState<string | null>(null);
  const [canManageNetworkSettings, setCanManageNetworkSettings] = useState(false);
  const [canManageNetworkPlugins, setCanManageNetworkPlugins] = useState(false);

  useEffect(() => {
    fetch("/api/nav/context", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        setAdminMode(json?.adminMode === "single-site" ? "single-site" : "multi-site");
        setMainSiteId(json?.mainSiteId ? String(json.mainSiteId) : null);
        setCanManageNetworkSettings(Boolean(json?.canManageNetworkSettings));
        setCanManageNetworkPlugins(Boolean(json?.canManageNetworkPlugins));
      })
      .catch(() => {
        setAdminMode("multi-site");
        setMainSiteId(null);
        setCanManageNetworkSettings(false);
        setCanManageNetworkPlugins(false);
      });
  }, []);

  const items = useMemo(
    () =>
      buildGlobalSettingsNavItems({
        adminMode,
        mainSiteId,
        canManageNetworkSettings,
        canManageNetworkPlugins,
      }),
    [adminMode, mainSiteId, canManageNetworkPlugins, canManageNetworkSettings],
  );

  return (
    <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 pt-2 dark:border-stone-700">
      {items.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          className={cn(
            "no-underline rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            segment === item.segment
              ? "bg-stone-200 text-black dark:bg-stone-700 dark:text-white"
              : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
          )}
        >
          {item.name}
        </Link>
      ))}
    </div>
  );
}
