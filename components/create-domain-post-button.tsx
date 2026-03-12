import Link from "next/link";
import { getDomainPostAdminCreatePath } from "@/lib/domain-post-admin-routes";

export default function CreateDomainPostButton({
  siteId,
  domainKey,
  domainLabel,
}: {
  siteId: string;
  domainKey: string;
  domainLabel: string;
}) {
  return (
    <Link
      href={getDomainPostAdminCreatePath(siteId, domainKey)}
      className="inline-flex h-10 items-center justify-center rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
    >
      Create New {domainLabel}
    </Link>
  );
}
