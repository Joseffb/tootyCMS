import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { getSiteMenu, saveSiteMenuFromJson } from "@/lib/menu-system";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteMenuSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const id = decodeURIComponent((await params).id);
  const site = await db.query.sites.findFirst({ where: (sites, { eq }) => eq(sites.id, id) });
  if (!site || site.userId !== session.user.id) notFound();
  const siteData = site;

  const headerMenu = await getSiteMenu(siteData.id, "header");

  async function saveHeaderMenu(formData: FormData) {
    "use server";
    const raw = String(formData.get("menu_json") || "[]");
    await saveSiteMenuFromJson(siteData.id, "header", raw);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Header Menu</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          JSON array format: <code>[{`{\"label\":\"Documentation\",\"href\":\"/c/documentation\"}`}]</code>
        </p>
        <form action={saveHeaderMenu} className="mt-4 flex flex-col gap-3">
          <textarea
            name="menu_json"
            defaultValue={JSON.stringify(headerMenu, null, 2)}
            rows={12}
            className="w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-xs dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <button className="w-fit rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
            Save Header Menu
          </button>
        </form>
      </div>
    </div>
  );
}
