// app/app/(dashboard)/site/[id]/settings/page.tsx
import Form from "@/components/form";
import { updateSite } from "@/lib/actions";
import DeleteSiteForm from "@/components/form/delete-site-form";
import CreateSiteButton from "@/components/create-site-button";
import CreateSiteModal from "@/components/modal/create-site";
import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { count, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteSettingsIndex({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const data = await db.query.sites.findFirst({
    where: (sites, { eq }) => eq(sites.id, decodeURIComponent(id)),
  });
  const [ownedSiteCount] = await db
    .select({ count: count() })
    .from(sites)
    .where(eq(sites.userId, session.user.id));

  // Handle case if no data is found
  if (!data) {
    notFound();
    return null; // Return nothing to avoid rendering issues
  }

  return (
    <>
      {/* Just for debugging, make sure rendering begins here */}
      <div className="flex flex-col space-y-6">
        <Form
          title="Name"
          description="The name of your site. This will be used as the meta title on Google as well."
          helpText="Please use 32 characters maximum."
          inputAttrs={{
            name: "name",
            type: "text",
            defaultValue: data?.name!,
            placeholder: "My Awesome Site",
            maxLength: 32,
          }}
          handleSubmit={updateSite}
        />

        <Form
          title="Description"
          description="The description of your site. This will be used as the meta description on Google as well."
          helpText="Include SEO-optimized keywords that you want to rank for."
          inputAttrs={{
            name: "description",
            type: "text",
            defaultValue: data?.description!,
            placeholder: "A blog about really interesting things.",
          }}
          handleSubmit={updateSite}
        />

        <Form
          title="Site Motto / Subtitle"
          description="Short subheading for your site brand voice. This is theme-neutral content."
          helpText="Keep it concise and human. This is commonly shown under titles in themes."
          inputAttrs={{
            name: "heroSubtitle",
            type: "text",
            defaultValue: data?.heroSubtitle || "",
            placeholder: "A CMS for teams that prefer releases over rituals.",
          }}
          handleSubmit={updateSite}
        />

        {ownedSiteCount.count > 1 &&
          (data.isPrimary || data.subdomain === "main" ? (
            <div className="rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
              <div className="relative flex flex-col space-y-4 p-5 sm:p-10">
                <h2 className="font-cal text-xl dark:text-white">URL</h2>
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  Primary URL slug for this site. This was previously labeled as Subdomain.
                </p>
                <div className="flex w-full max-w-md">
                  <input
                    value={data?.subdomain || "main"}
                    disabled
                    className="w-full max-w-md cursor-not-allowed rounded-md border border-stone-300 bg-stone-100 text-sm text-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-400"
                  />
                  <div className="flex items-center rounded-r-md border border-l-0 border-stone-300 bg-stone-100 px-3 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400">
                    {process.env.NEXT_PUBLIC_ROOT_DOMAIN}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center space-y-2 rounded-b-lg border-t border-stone-200 bg-stone-50 p-3 sm:flex-row sm:justify-between sm:space-y-0 sm:px-10 dark:border-stone-700 dark:bg-stone-800">
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  Main Site URL is locked and cannot be changed.
                </p>
              </div>
            </div>
          ) : (
            <Form
              title="URL"
              description="Primary URL slug for this site. This was previously labeled as Subdomain."
              helpText="Lowercase letters, numbers, and hyphens only. 32 characters maximum."
              inputAttrs={{
                name: "subdomain",
                type: "text",
                defaultValue: data?.subdomain!,
                placeholder: "main",
                maxLength: 32,
              }}
              handleSubmit={updateSite}
            />
          ))}

        {data.isPrimary || data.subdomain === "main" ? (
          <div className="rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
            <div className="relative flex flex-col space-y-4 p-5 sm:p-10">
              <h2 className="font-cal text-xl dark:text-white">Enable Multisite</h2>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Enable multisite by adding a second site.
              </p>
              <div className="w-fit">
                <CreateSiteButton label="Add New Site">
                  <CreateSiteModal />
                </CreateSiteButton>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center space-y-2 rounded-b-lg border-t border-stone-200 bg-stone-50 p-3 sm:flex-row sm:justify-between sm:space-y-0 sm:px-10 dark:border-stone-700 dark:bg-stone-800">
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {ownedSiteCount.count > 1
                  ? "Multisite is enabled for your account."
                  : "Single-site mode remains active until a second site is created."}
              </p>
            </div>
          </div>
        ) : (
          <DeleteSiteForm siteName={Promise.resolve({ siteName: data?.name! })} />
        )}
      </div>
    </>
  );
}
