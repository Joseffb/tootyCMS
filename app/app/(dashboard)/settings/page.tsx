import Link from "next/link";

const cards = [
  { title: "Sites", href: "/settings/sites", desc: "Tabular site index with links to site-specific settings." },
  { title: "Themes", href: "/settings/themes", desc: "Enable themes and manage theme-level options." },
  { title: "Plugins", href: "/settings/plugins", desc: "Enable plugins and configure plugin settings." },
  { title: "Schedules", href: "/settings/schedules", desc: "Manage cron-like toggles and automation intent." },
  { title: "Users", href: "/settings/users", desc: "CRUD users and roles, plus OAuth provider toggles." },
  { title: "Reading", href: "/settings/reading", desc: "SEO defaults, robots behavior, site URL, and cache reset." },
  { title: "Writing", href: "/settings/writing", desc: "Editor and permalink defaults for content authoring." },
];

export default function SettingsPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="rounded-lg border border-stone-200 bg-white p-5 transition hover:border-stone-400 dark:border-stone-700 dark:bg-black"
        >
          <h2 className="font-cal text-xl dark:text-white">{card.title}</h2>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{card.desc}</p>
        </Link>
      ))}
    </div>
  );
}
