import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWritingSettingsAdmin, updateWritingSettings } from "@/lib/actions";

export default async function WritingSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await getWritingSettingsAdmin();

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Writing</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Set authoring defaults for permalink and editor style. Taxonomy bases are short URLs.
      </p>
      <form action={updateWritingSettings} className="mt-4 grid gap-4 max-w-xl">
        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Permalink Style</span>
          <select
            name="writing_permalink_style"
            defaultValue={settings.permalinkStyle}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          >
            <option value="post-name">Post name (SEO-safe)</option>
            <option value="year-month-post-name">Year/Month/Post name</option>
          </select>
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Category Base</span>
          <input
            name="writing_category_base"
            defaultValue={settings.categoryBase}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            readOnly
          />
          <span className="text-xs text-stone-500 dark:text-stone-400">Uses `/c/:slug`.</span>
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Tag Base</span>
          <input
            name="writing_tag_base"
            defaultValue={settings.tagBase}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            readOnly
          />
          <span className="text-xs text-stone-500 dark:text-stone-400">Uses `/t/:slug`.</span>
        </label>

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Editor Mode</span>
          <select
            name="writing_editor_mode"
            defaultValue={settings.editorMode}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
          >
            <option value="rich-text">Visual (Rich text)</option>
            <option value="html-css-first">HTML/CSS-first</option>
          </select>
        </label>

        <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
          Save Writing Settings
        </button>
      </form>
    </div>
  );
}
