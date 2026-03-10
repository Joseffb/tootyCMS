import Link from "next/link";
import { createId } from "@paralleldrive/cuid2";
import { getSiteDataDomainByKey } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { resolveAuthorizedSiteForUser } from "@/lib/admin-site-selection";
import { getDomainPostAdminListPath } from "@/lib/domain-post-admin-routes";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
};

export default async function CreateDomainEntryPage({ params }: Props) {
  noStore();
  const session = await getSession();
  if (!session) redirect("/login");

  const { id, domainKey } = await params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);

  const { site } = await resolveAuthorizedSiteForUser(session.user.id, siteId, "site.content.create");
  if (!site) notFound();
  const effectiveSiteId = site.id;

  const domain = await getSiteDataDomainByKey(effectiveSiteId, resolvedDomainKey);
  if (!domain) notFound();

  const listPath = getDomainPostAdminListPath(effectiveSiteId, resolvedDomainKey);
  const createPath = `/app/site/${encodeURIComponent(effectiveSiteId)}/domain/${encodeURIComponent(resolvedDomainKey)}/create/draft`;
  const draftNonce = createId();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-950">
      <div className="space-y-2">
        <h1 className="font-cal text-3xl text-stone-950 dark:text-stone-50">Create {domain.label}</h1>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Draft creation is explicit here so retries and refreshes cannot silently create duplicate entries.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <form method="post" action={createPath}>
          <input type="hidden" name="draftNonce" value={draftNonce} />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
          >
            Create Draft {domain.label}
          </button>
        </form>
        <Link
          href={listPath}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 transition hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
