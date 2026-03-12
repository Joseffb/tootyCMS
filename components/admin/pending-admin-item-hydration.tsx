"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function normalizeAdminPathname(pathname: string) {
  return String(pathname || "").replace(/^\/app\/cp(?=\/|$)/, "/app");
}

function isAdminEditorSurfaceReady() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector('input[placeholder="Title"]') ||
      document.querySelector('textarea[placeholder="Title"]') ||
      document.querySelector("#post-slug") ||
      Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Save Changes") ||
      Array.from(document.querySelectorAll("*")).some(
        (element) => element.textContent?.trim() === "Read-only: you can view content but cannot modify this post.",
      ),
  );
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
    const isPendingHydrationPath = searchParams?.get("pending") === "1";
    if (normalizedCurrentPathname !== normalizedCanonicalPathname || currentPath !== canonicalPath) {
      if (normalizedCurrentPathname === normalizedCanonicalPathname && isPendingHydrationPath) {
        // Keep ?pending=1 in place until the editor has hydrated. The item
        // page clears it after successful hydration via ReplaceAdminItemUrlInPlace.
      } else {
        router.replace(canonicalPath);
        return;
      }
    }
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const tick = (attempt: number) => {
      if (!active) return;
      if (Date.now() - startedAt >= timeoutMs) {
        if (typeof window !== "undefined") {
          window.location.reload();
        } else {
          router.refresh();
        }
        return;
      }
      if (attempt % 8 === 0) {
        if (typeof window !== "undefined") {
          window.location.reload();
        } else {
          router.refresh();
        }
      } else {
        router.refresh();
      }
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

export function ReplaceAdminItemUrlInPlace({
  canonicalPath,
  waitForEditorReady = false,
  timeoutMs = 90_000,
}: {
  canonicalPath: string;
  waitForEditorReady?: boolean;
  timeoutMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentUrl = new URL(window.location.href);
    const targetUrl = new URL(canonicalPath, currentUrl.origin);
    const normalizedCurrentPathname = normalizeAdminPathname(currentUrl.pathname);
    const normalizedTargetPathname = normalizeAdminPathname(targetUrl.pathname);
    const nextPath = `${currentUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    const currentPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    const sameCanonicalPath = normalizedCurrentPathname === normalizedTargetPathname;
    const pendingHydration = currentUrl.searchParams.get("pending") === "1";

    const normalizeInPlace = () => {
      const latestUrl = new URL(window.location.href);
      const latestTargetUrl = new URL(canonicalPath, latestUrl.origin);
      const latestNormalizedCurrentPathname = normalizeAdminPathname(latestUrl.pathname);
      const latestNormalizedTargetPathname = normalizeAdminPathname(latestTargetUrl.pathname);
      const latestNextPath = `${latestUrl.pathname}${latestTargetUrl.search}${latestTargetUrl.hash}`;
      const latestCurrentPath = `${latestUrl.pathname}${latestUrl.search}${latestUrl.hash}`;
      if (latestNormalizedCurrentPathname === latestNormalizedTargetPathname) {
        if (latestCurrentPath !== latestNextPath) {
          window.history.replaceState(window.history.state, "", latestNextPath);
        }
        return;
      }
      const latestCurrentCanonicalPath = `${latestUrl.pathname}${latestUrl.search || ""}`;
      if (latestCurrentCanonicalPath === canonicalPath) return;
      window.history.replaceState(window.history.state, "", canonicalPath);
    };

    if (!(waitForEditorReady && sameCanonicalPath && pendingHydration)) {
      normalizeInPlace();
      return;
    }

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const tick = (attempt: number) => {
      if (!active) return;
      if (isAdminEditorSurfaceReady()) {
        normalizeInPlace();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.location.reload();
        return;
      }
      if (attempt % 8 === 0) {
        window.location.reload();
      } else {
        router.refresh();
      }
      timeoutId = setTimeout(() => tick(attempt + 1), Math.min(750 + attempt * 150, 2_000));
    };

    timeoutId = setTimeout(() => tick(1), 750);

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [canonicalPath, router, timeoutMs, waitForEditorReady]);

  return null;
}
