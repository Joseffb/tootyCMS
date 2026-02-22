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
      <h2 className="font-cal text-xl dark:text-white">Reading and SEO</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Site-specific SEO and canonical URL settings.
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
            name="seo_indexing_enabled"
            defaultChecked={result.indexingEnabled}
            className="h-4 w-4"
          />
          <span>Allow search indexing (site-level)</span>
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

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Default SEO Title</span>
          <input
            type="text"
            name="seo_meta_title"
            defaultValue={result.seoMetaTitle}
            placeholder="Site title"
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Default SEO Description</span>
          <textarea
            name="seo_meta_description"
            defaultValue={result.seoMetaDescription}
            placeholder="Default SEO description"
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
        </label>

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
