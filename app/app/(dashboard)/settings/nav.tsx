"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

const items = [
  { name: "Sites", href: "/settings/sites", segment: "sites" },
  { name: "Themes", href: "/settings/themes", segment: "themes" },
  { name: "Plugins", href: "/settings/plugins", segment: "plugins" },
  { name: "Database", href: "/settings/database", segment: "database" },
  { name: "Schedules", href: "/settings/schedules", segment: "schedules" },
  { name: "Users", href: "/settings/users", segment: "users" },
];

export default function GlobalSettingsNav() {
  const segment = useSelectedLayoutSegment();

  return (
    <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 pt-2 dark:border-stone-700">
      {items.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
