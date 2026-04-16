import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSiteReadingSettingsAdmin, updateSiteReadingSettings } from "@/lib/actions";
import PermalinkModeFields from "../writing/permalink-mode-fields";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteReadingSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const result = await getSiteReadingSettingsAdmin(id);
  if ("error" in result) {
    redirect("/app");
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Reading</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Site-level reading, header, RSS, and permalink settings.
      </p>
      <form
        action={async (formData) => {
          "use server";
          await updateSiteReadingSettings(formData);
        }}
        className="mt-4 space-y-4"
      >
        <input type="hidden" name="siteId" value={result.siteId} />

        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input
            type="checkbox"
            name="random_default_images_enabled"
            defaultChecked={result.randomDefaultsEnabled}
            className="h-4 w-4"
          />
          <span>Assign random default image when no image is provided</span>
        </label>

        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input
            type="checkbox"
            name="main_header_enabled"
            defaultChecked={result.mainHeaderEnabled}
            className="h-4 w-4"
          />
          <span>Enable main header on site pages</span>
        </label>

        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input
            type="checkbox"
            name="main_header_show_network_sites"
            defaultChecked={result.showNetworkSites}
            className="h-4 w-4"
          />
          <span>Show network sites list in header</span>
        </label>

        <div className="rounded-md border border-stone-200 p-4 dark:border-stone-700">
          <h3 className="font-medium dark:text-white">RSS Feed</h3>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Publish a single canonical site feed at <code>/feed.xml</code>.
          </p>
          {!result.rss.networkEnabled ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Network RSS is currently disabled. Site-level RSS controls are read-only until it is turned back on in
              network Reading settings.
            </p>
          ) : null}
          <fieldset disabled={!result.rss.networkEnabled} className="mt-4 space-y-4 disabled:opacity-60">
            <label className="flex items-center gap-3 text-sm dark:text-white">
              <input
                type="checkbox"
                name="rss_enabled"
                defaultChecked={result.rss.enabled}
                className="h-4 w-4"
              />
              <span>Enable RSS for this site</span>
            </label>

            <label className="flex flex-col gap-2 text-sm dark:text-white">
              <span>Feed content</span>
              <select
                name="rss_content_mode"
                defaultValue={result.rss.contentMode}
                className="max-w-xs rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
              >
                <option value="excerpt">Excerpt only</option>
                <option value="full">Full content</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm dark:text-white">
              <span>Items per feed</span>
              <input
                type="number"
                min={1}
                max={100}
                name="rss_items_per_feed"
                defaultValue={result.rss.itemsPerFeed}
                className="max-w-xs rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
              />
            </label>

            <div className="space-y-2 text-sm dark:text-white">
              <span className="block">Include post types</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.rssDomainOptions.map((domain) => (
                  <label key={domain.key} className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
                    <input
                      type="checkbox"
                      name="rss_include_domain_keys"
                      value={domain.key}
                      defaultChecked={result.rss.includedDomainKeys.includes(domain.key)}
                      className="h-4 w-4"
                    />
                    <span>{domain.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        </div>

        <PermalinkModeFields
          mode={result.writingSettings.permalinkMode}
          singlePattern={result.writingSettings.singlePattern}
          listPattern={result.writingSettings.listPattern}
          noDomainPrefix={result.writingSettings.noDomainPrefix}
          noDomainDataDomain={result.writingSettings.noDomainDataDomain}
          domains={result.dataDomains}
        />

        <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
          Save Reading Settings
        </button>
      </form>
    </div>
  );
}
