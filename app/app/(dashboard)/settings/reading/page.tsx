import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReadingSettingsAdmin, resetCmsCache, updateReadingSettings } from "@/lib/actions";
import { getRootSiteUrl } from "@/lib/site-url";

export default async function ReadingSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await getReadingSettingsAdmin();
  const canonicalPlaceholder = getRootSiteUrl();

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Reading and SEO</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Configure canonical URL, robots indexing, RSS defaults, and SEO defaults.
        </p>
        <form action={updateReadingSettings} className="mt-4 space-y-4">
          <label className="flex items-center gap-3 text-sm dark:text-white">
            <input
              type="checkbox"
              name={settings.randomDefaults.key}
              defaultChecked={settings.randomDefaults.enabled}
              className="h-4 w-4"
            />
            <span>Assign random default image when no image is provided</span>
          </label>

          <label className="flex items-center gap-3 text-sm dark:text-white">
            <input
              type="checkbox"
              name="seo_indexing_enabled"
              defaultChecked={settings.seo.indexingEnabled}
              className="h-4 w-4"
            />
            <span>Allow search indexing (controls robots.txt)</span>
          </label>

          <label className="flex items-center gap-3 text-sm dark:text-white">
            <input
              type="checkbox"
              name="main_header_enabled"
              defaultChecked={settings.header.mainHeaderEnabled}
              className="h-4 w-4"
            />
            <span>Enable main header on site pages</span>
          </label>

          <label className="flex items-center gap-3 text-sm dark:text-white">
            <input
              type="checkbox"
              name="main_header_show_network_sites"
              defaultChecked={settings.header.showNetworkSites}
              className="h-4 w-4"
            />
            <span>Show network sites list in main header</span>
          </label>

          <div className="rounded-md border border-stone-200 p-4 dark:border-stone-700">
            <h3 className="font-medium dark:text-white">RSS Defaults</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              WordPress-style feed controls for every site. Turning RSS off here disables it network-wide.
            </p>
            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-3 text-sm dark:text-white">
                <input
                  type="checkbox"
                  name="rss_network_enabled"
                  defaultChecked={settings.rss.networkEnabled}
                  className="h-4 w-4"
                />
                <span>Enable RSS feeds across the network</span>
              </label>

              <label className="flex items-center gap-3 text-sm dark:text-white">
                <input
                  type="checkbox"
                  name="rss_default_enabled"
                  defaultChecked={settings.rss.defaultEnabled}
                  className="h-4 w-4"
                />
                <span>Enable RSS by default for new and existing sites</span>
              </label>

              <label className="flex flex-col gap-2 text-sm dark:text-white">
                <span>Default feed content</span>
                <select
                  name="rss_default_content_mode"
                  defaultValue={settings.rss.contentMode}
                  className="max-w-xs rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
                >
                  <option value="excerpt">Excerpt only</option>
                  <option value="full">Full content</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm dark:text-white">
                <span>Default items per feed</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  name="rss_default_items_per_feed"
                  defaultValue={settings.rss.itemsPerFeed}
                  className="max-w-xs rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </label>
            </div>
          </div>

          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>Canonical Site URL</span>
            <input
              type="text"
              name={settings.siteUrl.key}
              defaultValue={settings.siteUrl.value}
              placeholder={canonicalPlaceholder}
              className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>Default SEO Title</span>
            <input
              type="text"
              name="seo_meta_title"
              defaultValue={settings.seo.metaTitle}
              placeholder="Tooty CMS"
              className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>Default SEO Description</span>
            <textarea
              name="seo_meta_description"
              defaultValue={settings.seo.metaDescription}
              placeholder="Dev-first CMS built for Next.js and Vercel"
              className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </label>

          <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
            Save Reading Settings
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Cache Control</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Force cache revalidation for pages and known content tags.
        </p>
        <form action={resetCmsCache} className="mt-4">
          <button className="rounded-md border border-amber-700 bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500">
            Revalidate / Reset Cache
          </button>
        </form>
      </div>
    </div>
  );
}
