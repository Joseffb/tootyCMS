"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function normalizeAdminPathname(pathname: string) {
  return String(pathname || "").replace(/^\/app\/cp(?=\/|$)/, "/app");
}

export function PendingAdminItemHydration({
  canonicalPath,
  timeoutMs = 90_000,
}: {
  canonicalPath: string;
  timeoutMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const canonicalPathname = String(canonicalPath || "").split("?")[0] || canonicalPath;
    const currentPathname = pathname || "";
    const normalizedCanonicalPathname = normalizeAdminPathname(canonicalPathname);
    const normalizedCurrentPathname = normalizeAdminPathname(currentPathname);
    const currentPath = `${currentPathname}${searchParams?.size ? `?${searchParams.toString()}` : ""}`;
    if (normalizedCurrentPathname !== normalizedCanonicalPathname || currentPath !== canonicalPath) {
      router.replace(canonicalPath);
      return;
    }

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const tick = (attempt: number) => {
      if (!active) return;
      if (Date.now() - startedAt >= timeoutMs) {
        router.refresh();
        return;
      }
      router.refresh();
      timeoutId = setTimeout(() => tick(attempt + 1), Math.min(750 + attempt * 150, 2_000));
    };

    timeoutId = setTimeout(() => tick(1), 750);

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [canonicalPath, pathname, router, searchParams, timeoutMs]);

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-6 text-stone-900 shadow-sm dark:border-stone-700 dark:bg-stone-950 dark:text-white">
      <h2 className="font-cal text-xl">Preparing editor</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        The new entry is being propagated. This page will refresh automatically until the editor is ready.
      </p>
    </div>
  );
}

export function NormalizeAdminItemUrl({ canonicalPath }: { canonicalPath: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(canonicalPath);
  }, [canonicalPath, router]);

  return null;
}

export function ReplaceAdminItemUrlInPlace({ canonicalPath }: { canonicalPath: string }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentUrl = new URL(window.location.href);
    const targetUrl = new URL(canonicalPath, currentUrl.origin);
    const normalizedCurrentPathname = normalizeAdminPathname(currentUrl.pathname);
    const normalizedTargetPathname = normalizeAdminPathname(targetUrl.pathname);
    if (normalizedCurrentPathname === normalizedTargetPathname) {
      const nextPath = `${currentUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
      const currentPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      if (currentPath !== nextPath) {
        window.history.replaceState(window.history.state, "", nextPath);
      }
      return;
    }
    const currentPath = `${currentUrl.pathname}${currentUrl.search || ""}`;
    if (currentPath === canonicalPath) return;
    window.history.replaceState(window.history.state, "", canonicalPath);
  }, [canonicalPath]);

  return null;
}
