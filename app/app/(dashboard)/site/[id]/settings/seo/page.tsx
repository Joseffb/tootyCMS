import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSiteSeoSettingsAdmin, updateSiteSeoSettings } from "@/lib/actions";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteSeoSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const result = await getSiteSeoSettingsAdmin(id);
  if ("error" in result) {
    redirect("/app");
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">SEO & Social</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Search and sharing metadata. Leave fields blank to inherit defaults from your site name and site motto.
      </p>
      <form
        action={async (formData) => {
          "use server";
          await updateSiteSeoSettings(formData);
        }}
        className="mt-4 space-y-4"
      >
        <input type="hidden" name="siteId" value={result.siteId} />

        <label className="flex items-center gap-3 text-sm dark:text-white">
          <input
            type="checkbox"
            name="seo_indexing_enabled"
            defaultChecked={result.indexingEnabled}
            className="h-4 w-4"
          />
          <span>Allow search indexing (site-level)</span>
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>SEO Title Override</span>
          <input
            type="text"
            name="seo_meta_title"
            defaultValue={result.seoMetaTitle}
            placeholder={result.defaults.metaTitle || "Site title"}
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>SEO Description Override</span>
          <textarea
            name="seo_meta_description"
            defaultValue={result.seoMetaDescription}
            placeholder={result.defaults.metaDescription || "Site motto or description"}
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Social Title Override (Open Graph/Twitter)</span>
          <input
            type="text"
            name="social_meta_title"
            defaultValue={result.socialMetaTitle}
            placeholder={result.defaults.socialTitle || result.defaults.metaTitle || "Site title"}
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Social Description Override (Open Graph/Twitter)</span>
          <textarea
            name="social_meta_description"
            defaultValue={result.socialMetaDescription}
            placeholder={result.defaults.socialDescription || result.defaults.metaDescription || "Site motto or description"}
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Social Image URL (Open Graph/Twitter)</span>
          <input
            type="text"
            name="social_meta_image"
            defaultValue={result.socialMetaImage}
            placeholder={result.defaults.socialImage || "/tooty/sprites/tooty-reading-cropped.png"}
            className="max-w-xl rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <span className="text-xs text-stone-500 dark:text-stone-400">
            Supports absolute URLs or site-relative paths.
          </span>
        </label>

        <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
          Save SEO & Social Settings
        </button>
      </form>
    </div>
  );
}
