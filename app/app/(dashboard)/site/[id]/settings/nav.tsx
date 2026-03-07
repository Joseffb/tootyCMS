"use client";

import { cn } from "@/lib/utils";
import { buildSiteSettingsNavItems } from "@/lib/admin-nav";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function SiteSettingsNav({ siteId }: { siteId: string }) {
  const segment = useSelectedLayoutSegment();
  const [adminMode, setAdminMode] = useState<"single-site" | "multi-site">("multi-site");
  const [canManageNetworkSettings, setCanManageNetworkSettings] = useState(false);

  useEffect(() => {
    fetch(`/api/nav/context?siteId=${encodeURIComponent(siteId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        setAdminMode(json?.adminMode === "single-site" ? "single-site" : "multi-site");
        setCanManageNetworkSettings(Boolean(json?.canManageNetworkSettings));
      })
      .catch(() => {
        setAdminMode("multi-site");
        setCanManageNetworkSettings(false);
      });
  }, [siteId]);

  const navItems = useMemo(
    () =>
      buildSiteSettingsNavItems({
        siteId,
        adminMode,
        canManageNetworkSettings,
      }),
    [adminMode, canManageNetworkSettings, siteId],
  );

  return (
    <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 pt-2 dark:border-stone-700">
      {navItems.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          // Change style depending on whether the link is active
          className={cn(
            "no-underline rounded-md px-2 py-1 text-sm font-medium transition-colors active:bg-stone-200 dark:active:bg-stone-600",
            segment === item.segment
              ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
              : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800",
          )}
        >
          {item.name}
        </Link>
      ))}
    </div>
  );
}
