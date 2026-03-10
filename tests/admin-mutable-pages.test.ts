import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readSource(filePath: string) {
  return readFileSync(path.join(process.cwd(), filePath), "utf8");
}

describe("mutable admin pages", () => {
  it("marks the domain create page as no-store and posts draft creation to a dedicated route handler", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/create/page.tsx");
    const routeSource = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/create/draft/route.ts");

    expect(source).toContain('import { unstable_noStore as noStore } from "next/cache";');
    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("export const revalidate = 0;");
    expect(source).toContain("export default async function CreateDomainEntryPage");
    expect(source).toContain("  noStore();");
    expect(source).toContain('const createPath = `/app/site/${encodeURIComponent(effectiveSiteId)}/domain/${encodeURIComponent(resolvedDomainKey)}/create/draft`;');
    expect(source).toContain("const draftNonce = createId();");
    expect(source).toContain('<form method="post" action={createPath}>');
    expect(source).toContain('<input type="hidden" name="draftNonce" value={draftNonce} />');
    expect(routeSource).toContain("export async function POST");
    expect(routeSource).toContain("const formData = await request.formData().catch(() => null);");
    expect(routeSource).toContain("const created = await createDomainPost(formData, effectiveSiteId, resolvedDomainKey);");
    expect(routeSource).toContain("const targetPath = getDomainPostAdminItemPath");
    expect(routeSource).toContain("return NextResponse.redirect(new URL(`${targetPath}?pending=1`, request.url), { status: 303 });");
  });

  it("marks the domain item page as no-store and retries first-read misses after create redirects", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");

    expect(source).toContain('import { unstable_noStore as noStore } from "next/cache";');
    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("export const revalidate = 0;");
    expect(source).toContain("async function getSiteDomainPostByIdWithRetry");
    expect(source).toContain("}, attempts = 45) {");
    expect(source).toContain("const pendingPostReadAttempts = isPendingHydration ? 60 : 45;");
    expect(source).toContain("const postPromise = getSiteDomainPostByIdWithRetry(");
    expect(source).toContain("pendingPostReadAttempts,");
    expect(source).toContain("  noStore();");
  });

  it("fast-paths fresh draft item hydration by skipping initial taxonomy and meta queries", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");

    expect(source).toContain("async function getHydratedPendingDomainPostWithRetry");
    expect(source).toContain("if (!latest || !isFreshDraftHydrationCandidate(latest)) return latest;");
    expect(source).toContain("if (!isFreshDraftHydrationCandidate(record)) {");
    expect(source).toContain("Date.now() - updatedAt.getTime() < 2 * 60 * 1000");
    expect(source).toContain('import { defaultEditorContent } from "@/lib/content";');
    expect(source).toContain("const normalizedContent = String(input.content || \"\").trim();");
    expect(source).toContain("const hasMeaningfulContent = (() => {");
    expect(source).toContain("return JSON.stringify(parsed) !== JSON.stringify(defaultEditorContent);");
    expect(source).toContain("const data =");
    expect(source).toContain("? await getHydratedPendingDomainPostWithRetry({");
    expect(source).toContain("function isFreshDraftHydrationCandidate");
    expect(source).toContain("const isFreshDraft = isFreshDraftHydrationCandidate(data);");
    expect(source).not.toContain("if (isPendingHydration && isFreshDraft) {");
    expect(source).toContain("const shouldFastPathHydration = isFreshDraft;");
    expect(source).toContain("const pendingReadRetryAttempts = isPendingHydration && !isFreshDraft ? 36 : 1;");
    expect(source).toContain("shouldFastPathHydration");
    expect(source).toContain("? Promise.resolve([])");
  });

  it("retries taxonomy and meta hydration on non-fresh pending item routes so pooled reads do not clear existing editor state", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");

    expect(source).toContain("async function getDomainPostTaxonomyRowsWithRetry");
    expect(source).toContain("async function getDomainPostMetaWithRetry");
    expect(source).toContain("if (rows.length > 0 || attempt === attempts) return rows;");
    expect(source).toContain("getDomainPostTaxonomyRowsWithRetry(");
    expect(source).toContain("getDomainPostMetaWithRetry(");
  });

  it("allows owner-created fresh drafts to open editable editor shells without waiting for a second mutation read", () => {
    const pageSource = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");
    const authSource = readSource("lib/authorization.ts");

    expect(pageSource).toContain("const allowOwnerFreshDraftEdit = canUserOpenFreshDraftEditorShell({");
    expect(pageSource).toContain("canEdit={canEdit.allowed || allowOwnerFreshDraftEdit}");
    expect(pageSource).not.toContain("data.userId === session.user.id");
    expect(authSource).toContain("export function canUserOpenFreshDraftEditorShell");
    expect(authSource).toContain("normalizedUserId !== ownerId");
    expect(authSource).toContain("!input.post.published");
  });

  it("marks the site menus settings page as no-store so list/detail mutations never reuse stale output", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/settings/menus/page.tsx");

    expect(source).toContain('import { unstable_noStore as noStore } from "next/cache";');
    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("export const revalidate = 0;");
    expect(source).toContain("export default async function SiteMenuSettingsPage");
    expect(source).toContain("  noStore();");
    expect(source).toContain("if (selectedMenuId && !selectedMenu) {");
    expect(source).toContain("await waitForMenuReadConsistency(siteData.id, selectedMenuId, (menu) => Boolean(menu), 12_000);");
    expect(source).toContain("menus = await listSiteMenus(siteData.id);");
  });

  it("routes transient item-route 404s into pending hydration instead of looping plain reloads", () => {
    const source = readSource("tests/e2e/site-lifecycle.spec.ts");

    expect(source).toContain("const shouldEnterPendingHydration =");
    expect(source).toContain("/\\/app\\/(?:cp\\/)?site\\/[^/]+\\/domain\\/[^/]+\\/item\\/[^/?]+$/.test(currentUrl.pathname)");
    expect(source).toContain('currentUrl.searchParams.set("pending", "1");');
    expect(source).toContain('await page.goto(currentUrl.toString(), { waitUntil: "domcontentloaded" }).catch(() => undefined);');
  });

  it("forces shell-only item routes through pending hydration without starving the pending recovery loop", () => {
    const source = readSource("tests/e2e/site-lifecycle.spec.ts");

    expect(source).toContain("let lastKnownUrl = page.url();");
    expect(source).toContain('if (activeUrl && !activeUrl.startsWith("chrome-error://")) {');
    expect(source).toContain('await page.goto(lastKnownUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);');
    expect(source).toContain('currentUrl.searchParams.set("pending", "1");');
    expect(source).toContain('pendingHydrationVisible || page.url().includes("pending=1")');
    expect(source).toContain("Extra test-driven reloads can starve eventual-consistency recovery.");
    expect(source).not.toContain("pendingSince ??= Date.now();");
  });

  it("waits for the editor to become editable after create instead of requiring an immediate strong DB read", () => {
    const source = readSource("tests/e2e/site-lifecycle.spec.ts");

    expect(source).toContain("const startedAt = Date.now();");
    expect(source).toContain("options?: { requireEditable?: boolean }");
    expect(source).toContain('getByText("Read-only: you can view content but cannot modify this post.")');
    expect(source).toContain("await page.getByPlaceholder(\"Title\").isEditable().catch(() => false)");
    expect(source).toContain("requireEditable && readOnlyVisible");
    expect(source).toContain("Date.now() - startedAt >= 5_000");
    expect(source).toContain("await waitForDomainPostPersistence({");
    expect(source).toContain('published: false,');
    expect(source).toContain("await waitForEditorSurface(page, 90_000, { requireEditable: true });");
  });

  it("keeps Category and Tags visible in the editor even before taxonomy overview hydration completes", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain("const DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS: TaxonomyOverviewRow[] = [");
    expect(source).toContain('{ taxonomy: "category", label: "Category", termCount: 0 }');
    expect(source).toContain('{ taxonomy: "tag", label: "Tags", termCount: 0 }');
    expect(source).toContain("const [taxonomyOverviewRows, setTaxonomyOverviewRows] = useState<TaxonomyOverviewRow[]>(");
    expect(source).toContain("DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS");
    expect(source).toContain("const sorted = mergeTaxonomyOverviewRows(rows);");
    expect(source).toContain("setTaxonomyOverviewRows(DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS);");
  });

  it("ignores stale pooled post payloads for recently mutated editor state so taxonomy and slug edits do not regress", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain(
      "const lastRecoveredCacheAtRef = useRef<number>(initialClientState.cachedEditorState?.savedAt ?? 0);",
    );
    expect(source).toContain("const lastLocalMutationAtRef = useRef<number>(0);");
    expect(source).toContain(
      "const termNameByIdRef = useRef<Record<number, string>>(initialClientState.termNameById);",
    );
    expect(source).toContain("const lastKnownEditorMutationAt = Math.max(");
    expect(source).toContain("const incomingServerSignature = buildEditorStateSignature({");
    expect(source).toContain("const incomingSignature = shouldUseCachedEditorState ? cachedEditorState!.signature : incomingServerSignature;");
    expect(source).toContain("const preserveStaleIncomingPost =");
    expect(source).toContain("Date.now() - lastKnownEditorMutationAt < 30_000");
    expect(source).toContain("incomingSignature !== lastSavedSignatureRef.current");
    expect(source).toContain("if (preserveLocalDraft || (preserveStaleIncomingPost && !shouldUseCachedEditorState)) {");
    expect(source).toContain("lastLocalMutationAtRef.current = Date.now();");
    expect(source).toContain("lastRecoveredCacheAtRef.current = cachedEditorState!.savedAt;");
    expect(source).toContain("dataRef.current = next;");
    expect(source).toContain("selectedTermsByTaxonomyRef.current = next;");
    expect(source).toContain("lastLocalMutationAtRef.current = Date.now();");
  });

  it("persists recent saved editor state in session storage so remounted item routes can recover taxonomy chips under pooled lag", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain('const EDITOR_SESSION_CACHE_KEY_PREFIX = "tooty.editor.snapshot.v1:";');
    expect(source).toContain("function readEditorSessionCache(postId: string)");
    expect(source).toContain("function writeEditorSessionCache(");
    expect(source).toContain("const cachedEditorState = readEditorSessionCache(post.id);");
    expect(source).toContain("const incomingServerUpdatedAt = (() => {");
    expect(source).toContain("cachedEditorState!.savedAt >= incomingServerUpdatedAt");
    expect(source).toContain("const shouldUseCachedEditorState =");
    expect(source).toContain("selectedTermsByTaxonomy: payload.selectedTermsByTaxonomy");
    expect(source).toContain("termNameById: termNameByIdRef.current");
    expect(source).toContain("setInitialContent(effectiveContent);");
    expect(source).toContain("lastSavedSignatureRef.current = cachedEditorState!.signature;");
  });

  it("eagerly initializes editor content on first mount so fresh draft item routes do not render a blank shell while waiting for client effects", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain(
      "const [initialContent, setInitialContent] = useState<JSONContent | null>(() => initialClientState.content);",
    );
    expect(source).not.toContain('const [initialContent, setInitialContent] = useState<JSONContent | null>(null);');
  });

  it("keeps pending editor hydration alive long enough for pooled-read convergence", () => {
    const source = readSource("components/admin/pending-admin-item-hydration.tsx");

    expect(source).toContain("timeoutMs = 90_000");
    expect(source).toContain("The new entry is being propagated. This page will refresh automatically until the editor is ready.");
  });

  it("treats /app and /app/cp admin item paths as the same canonical editor route during hydration", () => {
    const source = readSource("components/admin/pending-admin-item-hydration.tsx");

    expect(source).toContain("function normalizeAdminPathname");
    expect(source).toContain('replace(/^\\/app\\/cp(?=\\/|$)/, "/app")');
    expect(source).toContain("const normalizedCanonicalPathname = normalizeAdminPathname(canonicalPathname);");
    expect(source).toContain("const normalizedCurrentPathname = normalizeAdminPathname(currentPathname);");
    expect(source).toContain('const currentPath = `${currentPathname}${searchParams?.size ? `?${searchParams.toString()}` : ""}`;');
    expect(source).toContain("if (normalizedCurrentPathname !== normalizedCanonicalPathname || currentPath !== canonicalPath) {");
  });

  it("normalizes pending item routes in place once the editor is already ready instead of forcing another client navigation", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");
    const hydrationSource = readSource("components/admin/pending-admin-item-hydration.tsx");

    expect(source).toContain("ReplaceAdminItemUrlInPlace");
    expect(source).not.toContain("NormalizeAdminItemUrl");
    expect(source).toContain(
      "{isPendingHydration ? <ReplaceAdminItemUrlInPlace canonicalPath={canonicalPath} /> : null}",
    );
    expect(hydrationSource).toContain("const normalizedCurrentPathname = normalizeAdminPathname(currentUrl.pathname);");
    expect(hydrationSource).toContain("const normalizedTargetPathname = normalizeAdminPathname(targetUrl.pathname);");
    expect(hydrationSource).toContain("const nextPath = `${currentUrl.pathname}${targetUrl.search}${targetUrl.hash}`;");
  });
});
