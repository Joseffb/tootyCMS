import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { listCommunicationMessages } from "@/lib/communications";

type Props = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    provider?: string;
    offset?: string;
  }>;
};

const PAGE_SIZE = 20;

const STATUS_OPTIONS = ["queued", "retrying", "sent", "failed", "dead", "logged"] as const;

function buildHref(base: string, params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function renderMessagesPage(input: {
  searchParams?: Props["searchParams"];
  siteId?: string;
  basePath: string;
  denyRedirectPath: string;
  requiredCapability: "network.plugins.manage" | "site.plugins.manage";
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const allowed = await userCan(input.requiredCapability, session.user.id, input.siteId ? { siteId: input.siteId } : undefined);
  if (!allowed) redirect(input.denyRedirectPath);

  const query = (await input.searchParams) || {};
  const q = String(query.q || "").trim();
  const status = String(query.status || "").trim();
  const provider = String(query.provider || "").trim();
  const offset = Math.max(0, Number.parseInt(String(query.offset || "0"), 10) || 0);

  const { items, hasMore, nextOffset } = await listCommunicationMessages({
    siteId: input.siteId,
    search: q,
    status,
    providerId: provider,
    limit: PAGE_SIZE,
    offset,
  });

  const subtitle = input.siteId
    ? "Communication queue and delivery states for this site."
    : "Communication queue and delivery states across sites.";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Messages</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          {subtitle}
        </p>
      </div>

      <form className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-4 dark:border-stone-700 dark:bg-black">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search id/to/subject/external"
          className="rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          name="provider"
          defaultValue={provider}
          placeholder="Provider id"
          className="rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
        />
        <button className="rounded border border-black bg-black px-3 py-1 text-sm text-white">Search</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 dark:bg-stone-900">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-stone-500" colSpan={7}>
                  No messages found.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="px-3 py-2 text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{row.siteName || row.siteId || "Global"}</td>
                  <td className="px-3 py-2 text-xs">{row.to}</td>
                  <td className="px-3 py-2 text-xs">{row.subject || "—"}</td>
                  <td className="px-3 py-2 text-xs">{row.status}</td>
                  <td className="px-3 py-2 text-xs font-mono">{row.providerId || "—"}</td>
                  <td className="px-3 py-2 text-xs">{row.attemptCount}/{row.maxAttempts}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && nextOffset !== null ? (
        <Link
          href={buildHref(input.basePath, { q, status, provider, offset: nextOffset })}
          className="inline-flex rounded border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-600"
        >
          Load more
        </Link>
      ) : null}
    </div>
  );
}

export default async function SettingsMessagesPage({ searchParams }: Props) {
  const query = (await searchParams) || {};
  return renderMessagesPage({
    searchParams: Promise.resolve(query),
    basePath: "/settings/messages",
    denyRedirectPath: "/app",
    requiredCapability: "network.plugins.manage",
  });
}
