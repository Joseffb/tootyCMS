import Link from "next/link";

type CatalogTab = "installed" | "discover";

export default function CatalogTabs({
  basePath,
  activeTab,
  enabled = true,
  installedLabel = "Installed",
}: {
  basePath: string;
  activeTab: CatalogTab;
  enabled?: boolean;
  installedLabel?: string;
}) {
  if (!enabled) return null;

  const tabs: Array<{ key: CatalogTab; label: string }> = [
    { key: "installed", label: installedLabel },
    { key: "discover", label: "Community" },
  ];

  return (
    <div className="flex items-center gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`${basePath}?tab=${tab.key}`}
          className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
            activeTab === tab.key
              ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
