"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function SiteSettingsNav() {
  const { id } = useParams() as { id?: string };
  const segment = useSelectedLayoutSegment();
  const [singleSiteMode, setSingleSiteMode] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);

  useEffect(() => {
    fetch("/api/nav/context", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const count = Number(json?.siteCount || 0);
        setSingleSiteMode(count === 1);
        setMigrationRequired(Boolean(json?.migrationRequired));
      })
      .catch(() => {
        setSingleSiteMode(false);
        setMigrationRequired(false);
      });
  }, []);

  const navItems = useMemo(() => ([
    {
      name: "General",
      href: `/site/${id}/settings`,
      segment: null,
    },
    {
      name: "Categories",
      href: `/site/${id}/settings/categories`,
      segment: "categories",
    },
    {
      name: "Post-Types",
      href: `/site/${id}/settings/domains`,
      segment: "domains",
    },
    {
      name: "Reading",
      href: `/site/${id}/settings/reading`,
      segment: "reading",
    },
    {
      name: "SEO & Social",
      href: `/site/${id}/settings/seo`,
      segment: "seo",
    },
    {
      name: "Writing",
      href: `/site/${id}/settings/writing`,
      segment: "writing",
    },
    {
      name: "Menus",
      href: `/site/${id}/settings/menus`,
      segment: "menus",
    },
    {
      name: "Themes",
      href: `/site/${id}/settings/themes`,
      segment: "themes",
    },
    {
      name: "Plugins",
      href: `/site/${id}/settings/plugins`,
      segment: "plugins",
    },
    {
      name: "Users",
      href: `/site/${id}/settings/users`,
      segment: "users",
    },
    ...(singleSiteMode
      ? [
          {
            name: "User Roles",
            href: `/site/${id}/settings/rbac`,
            segment: "rbac",
          },
          {
            name: "Schedules",
            href: `/site/${id}/settings/schedules`,
            segment: "schedules",
          },
          ...(migrationRequired
            ? [
                {
                  name: "Database",
                  href: `/site/${id}/settings/database`,
                  segment: "database",
                },
              ]
            : []),
        ]
      : []),
  ]), [id, singleSiteMode, migrationRequired]);

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
