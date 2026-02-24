"use client";

import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import LoadingDots from "@/components/icons/loading-dots";

export default function CreateDomainPostButton({
  siteId,
  domainKey,
  domainLabel,
}: {
  siteId: string;
  domainKey: string;
  domainLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          router.push(`/site/${siteId}/domain/${domainKey}/create`);
        })
      }
      className={cn(
        "flex h-8 w-44 items-center justify-center space-x-2 rounded-lg border text-sm transition-all focus:outline-none sm:h-9",
        isPending
          ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
          : "border border-black bg-black text-white hover:bg-white hover:text-black active:bg-stone-100 dark:border-stone-700 dark:hover:border-stone-200 dark:hover:bg-black dark:hover:text-white dark:active:bg-stone-800",
      )}
      disabled={isPending}
    >
      {isPending ? <LoadingDots color="#808080" /> : <p>Create New {domainLabel}</p>}
    </button>
  );
}
