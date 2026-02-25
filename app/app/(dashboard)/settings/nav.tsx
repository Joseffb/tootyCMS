"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const BASE_ITEMS = [
  { name: "Sites", href: "/settings/sites", segment: "sites" },
  { name: "Themes", href: "/settings/themes", segment: "themes" },
  { name: "Plugins", href: "/settings/plugins", segment: "plugins" },
  { name: "Messages", href: "/settings/messages", segment: "messages" },
  { name: "Schedules", href: "/settings/schedules", segment: "schedules" },
  { name: "Users", href: "/settings/users", segment: "users" },
  { name: "User Roles", href: "/settings/rbac", segment: "rbac" },
];

export default function GlobalSettingsNav() {
  const segment = useSelectedLayoutSegment();
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [singleSiteMode, setSingleSiteMode] = useState(false);
  const [canManageNetworkSettings, setCanManageNetworkSettings] = useState(false);
  const [canManageNetworkPlugins, setCanManageNetworkPlugins] = useState(false);

  useEffect(() => {
    fetch("/api/nav/context", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const count = Number(json?.siteCount || 0);
        setSingleSiteMode(count === 1);
        setMigrationRequired(Boolean(json?.migrationRequired));
        setCanManageNetworkSettings(Boolean(json?.canManageNetworkSettings));
        setCanManageNetworkPlugins(Boolean(json?.canManageNetworkPlugins));
      })
      .catch(() => {
        setSingleSiteMode(false);
        setMigrationRequired(false);
        setCanManageNetworkSettings(false);
        setCanManageNetworkPlugins(false);
      });
  }, []);

  const items = useMemo(
    () => {
      if (!canManageNetworkSettings) return [];
      const base = BASE_ITEMS.filter((item) => {
        if (singleSiteMode && item.name === "Sites") return false;
        if (!canManageNetworkPlugins && item.name === "Messages") return false;
        return true;
      });
      if (!migrationRequired) return base;
      return [...base.slice(0, 3), { name: "Database", href: "/settings/database", segment: "database" }, ...base.slice(3)];
    },
    [migrationRequired, singleSiteMode, canManageNetworkPlugins, canManageNetworkSettings],
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
