import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSiteEditorSettingsAdmin, updateSiteEditorSettings } from "@/lib/actions";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteWritingSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const result = await getSiteEditorSettingsAdmin(id);
  if ("error" in result) {
    redirect("/app");
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Writing</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Editor defaults for this site.
      </p>
      <form
        action={async (formData) => {
          "use server";
          await updateSiteEditorSettings(formData);
        }}
        className="mt-4 grid max-w-2xl gap-4"
      >
        <input type="hidden" name="siteId" value={result.siteId} />

        <label className="flex flex-col gap-2 text-sm dark:text-white">
          <span>Editor Mode</span>
          <select
            name="writing_editor_mode"
            defaultValue={result.editorMode}
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
