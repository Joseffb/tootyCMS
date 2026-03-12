import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readSource(filePath: string) {
  return readFileSync(path.join(process.cwd(), filePath), "utf8");
}

describe("mutable admin pages", () => {
  it("marks the domain create page as no-store and redirects directly into a host-safe blank item shell", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/create/page.tsx");
    const routeSource = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/create/draft/route.ts");
    const requestOriginSource = readSource("lib/request-origin.ts");

    expect(source).toContain('import { unstable_noStore as noStore } from "next/cache";');
    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("export const revalidate = 0;");
    expect(source).toContain("export default async function CreateDomainEntryPage");
    expect(source).toContain("  noStore();");
    expect(source).toContain('import { createId } from "@paralleldrive/cuid2";');
    expect(source).toContain("const draftId = createId();");
    expect(source).toContain("getDomainPostAdminItemPath");
    expect(source).toContain('redirect(`${targetPath}?new=1`)');
    expect(source).not.toContain("CreateDomainPostForm");
    expect(routeSource).toContain("export async function POST");
    expect(routeSource).toContain('import { deriveRequestOriginFromRequest } from "@/lib/request-origin";');
    expect(routeSource).toContain('import { createId } from "@paralleldrive/cuid2";');
    expect(routeSource).toContain("const requestOrigin = deriveRequestOriginFromRequest(request);");
    expect(routeSource).toContain("const formData = await request.formData().catch(() => null);");
    expect(routeSource).toContain("const requestedDraftNonce = String(formData?.get(\"draftNonce\") || \"\")");
    expect(routeSource).toContain("const draftId =");
    expect(routeSource).toContain("const targetPath = getDomainPostAdminItemPath");
    expect(routeSource).toContain("return NextResponse.redirect(new URL(`${targetPath}?new=1`, requestOrigin), { status: 303 });");
    expect(requestOriginSource).toContain("export function deriveRequestOriginFromRequest(request: Request)");
    expect(requestOriginSource).toContain('request.headers.get("x-forwarded-host")');
    expect(requestOriginSource).toContain('request.headers.get("x-forwarded-proto")');
  });

  it("renders a blank editor shell for /item/{id}?new=1 instead of 404ing missing rows", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");
    const editorSource = readSource("components/editor/editor.tsx");

    expect(source).toContain('new?: string;');
    expect(source).toContain('const isNewDraft = String(resolvedSearchParams.new || "").trim() === "1";');
    expect(source).toContain("if (!data && isNewDraft) {");
    expect(source).toContain('userCan("site.content.create", session.user.id, { siteId: effectiveSiteId })');
    expect(source).toContain("id: resolvedPostId,");
    expect(source).toContain("slug: \"\",");
    expect(source).toContain("categories: [],");
    expect(source).toContain("tags: [],");
    expect(source).toContain("meta: [],");
    expect(source).toContain("canEdit");
    expect(source).toContain("materializeDraftOnFirstSave");
    expect(editorSource).toContain("materializeDraftOnFirstSave = false");
    expect(editorSource).toContain("draftShellMaterializedRef");
  });

  it("marks fresh editor mutations unsaved immediately so first draft autosaves cannot look idle before enqueue", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain("const markLocalDirty = () => {");
    expect(source).toContain('setSaveStatus("unsaved");');
    expect(source).toContain("markLocalDirty();\n    setData(next);");
    expect(source).toContain("markLocalDirty();\n    setSelectedTermsByTaxonomy(next);");
    expect(source).toContain("if (hadLocalEditorMutation) {\n                  markLocalDirty();\n                }");
  });

  it("marks the domain item page as no-store and retries first-read misses after create redirects", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");

    expect(source).toContain('import { unstable_noStore as noStore } from "next/cache";');
    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("export const revalidate = 0;");
    expect(source).toContain("async function getSiteDomainPostByIdWithRetry");
    expect(source).toContain("}, attempts = 45) {");
    expect(source).toContain("const pendingPostReadAttempts = isNewDraft ? 1 : isPendingHydration ? 60 : 45;");
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
    expect(source).toContain("async function readMenuWithFallback(siteId: string, menuId: string)");
    expect(source).toContain("const shouldRenderPendingMenuState = Boolean(selectedMenuId && pendingMenuTitle);");
    expect(source).toContain("if (selectedMenuId && !selectedMenu && !shouldRenderPendingMenuState) {");
    expect(source).toContain("await waitForMenuReadConsistency(siteData.id, selectedMenuId, (menu) => Boolean(menu), 12_000)");
    expect(source).toContain("const record = menuId");
    expect(source).toContain("? await updateSiteMenu(siteData.id, menuId, payload)");
    expect(source).toContain(": await createSiteMenu(siteData.id, payload);");
    expect(source).toContain("await waitForMenuReadConsistency(");
    expect(source).toContain("menu.location === record.location");
    expect(source).toContain("menuId ? 12_000 : 20_000");
    expect(source).toContain("revalidateMenuPaths(siteData.id, adminBasePath);");
    expect(source).toContain("pendingMenuTitle: record.title");
    expect(source).toContain("pendingMenuKey: record.key");
    expect(source).toContain('Syncing the newly saved menu. Details will appear as soon as the database read catches up.');
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
    expect(source).toContain("await waitForEditorSurface(page, 90_000, { requireEditable: true });");
    expect(source).toContain("`${appOrigin}/app/site/${primarySiteId}/domain/post/item/${createdPostId}`");
    expect(source).not.toContain('published: false,');
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
    expect(source).toContain("const mountedTitleValue = titleInputRef.current?.value;");
    expect(source).toContain("const mountedDescriptionValue = descriptionInputRef.current?.value;");
    expect(source).toContain("const mountedSlugValue = slugInputRef.current?.value;");
    expect(source).toContain("const currentClientSignature = buildEditorStateSignature({");
    expect(source).toContain("const preserveStaleIncomingPost =");
    expect(source).toContain("const preserveRecentLocalDraft =");
    expect(source).toContain("const preserveAnyRecentLocalEdit =");
    expect(source).toContain("Date.now() - lastKnownEditorMutationAt < 30_000");
    expect(source).toContain("incomingSignature !== lastSavedSignatureRef.current");
    expect(source).toContain("Date.now() - lastLocalMutationAtRef.current < 30_000");
    expect(source).toContain("currentClientSignature !== incomingSignature");
    expect(source).toContain("title: mountedTitleValue ?? titleValueRef.current ?? dataRef.current?.title ?? \"\",");
    expect(source).toContain("description: mountedDescriptionValue ?? descriptionValueRef.current ?? dataRef.current?.description ?? \"\",");
    expect(source).toContain("slug: mountedSlugValue ?? slugValueRef.current ?? dataRef.current?.slug ?? \"\",");
    expect(source).toContain("preserveAnyRecentLocalEdit ||");
    expect(source).toContain("(preserveStaleIncomingPost && !shouldUseCachedEditorState)");
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
    expect(source).toContain("const enqueueSave = (immediate = false, snapshot?: EditorSaveSnapshot) => {");
    expect(source).toContain("writeEditorSessionCache(");
    expect(source).toContain("const cachedEditorState = readEditorSessionCache(post.id);");
    expect(source).toContain("const incomingServerUpdatedAt = (() => {");
    expect(source).toContain("cachedEditorState!.savedAt >= incomingServerUpdatedAt");
    expect(source).toContain("const shouldUseCachedEditorState =");
    expect(source).toContain("selectedTermsByTaxonomy: payload.selectedTermsByTaxonomy");
    expect(source).toContain("termNameById: termNameByIdRef.current");
    expect(source).toContain("setInitialContent(effectiveContent);");
    expect(source).toContain("lastSavedSignatureRef.current = cachedEditorState!.signature;");
  });

  it("preserves newer local slug, content, and taxonomy state when an older temp-draft save resolves late", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain("const preserveNewerLocalDraft = hasNewerQueuedDraft();");
    expect(source).toContain("const currentLocalPost = dataRef.current;");
    expect(source).toContain("const currentLocalSelectedTermsByTaxonomy = selectedTermsByTaxonomyRef.current;");
    expect(source).toContain("const currentLocalMetaEntries = metaEntriesRef.current;");
    expect(source).toContain("const hasMountedTitleField = titleInputRef.current != null;");
    expect(source).toContain("const hasMountedDescriptionField = descriptionInputRef.current != null;");
    expect(source).toContain("const hasMountedSlugField = slugInputRef.current != null;");
    expect(source).toContain('const liveTitleValue = titleInputRef.current?.value ?? "";');
    expect(source).toContain('const liveDescriptionValue = descriptionInputRef.current?.value ?? "";');
    expect(source).toContain('const liveSlugValue = slugInputRef.current?.value ?? "";');
    expect(source).toContain("title:");
    expect(source).toContain("preserveNewerLocalDraft || hasMountedTitleField");
    expect(source).toContain("(liveTitleValue || titleValueRef.current || currentLocalPost.title || payload.title)");
    expect(source).toContain("preserveNewerLocalDraft || hasMountedSlugField");
    expect(source).toContain("slug:");
    expect(source).toContain("const nextSelectedTermsByTaxonomy = preserveNewerLocalDraft");
    expect(source).toContain("? currentLocalSelectedTermsByTaxonomy");
    expect(source).toContain(": payload.selectedTermsByTaxonomy;");
  });

  it("builds explicit save snapshots from live mounted title, description, and slug fields before falling back to cached refs", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain("const hasMountedTitleField = titleInputRef.current != null;");
    expect(source).toContain("const hasMountedDescriptionField = descriptionInputRef.current != null;");
    expect(source).toContain("const hasMountedSlugField = slugInputRef.current != null;");
    expect(source).toContain('const liveTitleValue = titleInputRef.current?.value ?? "";');
    expect(source).toContain('const liveDescriptionValue = descriptionInputRef.current?.value ?? "";');
    expect(source).toContain('const liveSlugValue = slugInputRef.current?.value ?? "";');
    expect(source).toContain('const nextTitle = hasMountedTitleField ? liveTitleValue : titleValueRef.current || latest.title || "";');
    expect(source).toContain("const nextDescription = hasMountedDescriptionField");
    expect(source).toContain("? liveDescriptionValue");
    expect(source).toContain(": descriptionValueRef.current || latest.description || \"\";");
    expect(source).toContain("const nextSlug = normalizeSeoSlug(");
    expect(source).toContain("hasMountedSlugField ? liveSlugValue : slugValueRef.current || latest.slug || \"\",");
  });

  it("uses the normal autosave queue for first temp-draft materialization instead of forcing an immediate title-only save", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).not.toContain("const shouldCreateImmediateDraft =");
    expect(source).not.toContain("enqueueSave(true, { data: nextData });");
    expect(source).toContain("const handleTitleInput = (value: string) => {");
    expect(source).toContain('if ((current.title ?? "") === value && titleValueRef.current === value) {');
    expect(source).toContain("const nextData = { ...current, title: value };");
    expect(source).toContain("applyDataUpdate(nextData);");
  });

  it("keeps the title input responsive in WebKit while using idempotent handlers to avoid duplicate metadata churn", () => {
    const source = readSource("components/editor/editor.tsx");

    expect(source).toContain('onInput={(e) => handleTitleInput((e.currentTarget as HTMLInputElement).value)}');
    expect(source).toContain('onChange={(e) => handleTitleInput(e.currentTarget.value)}');
    expect(source).toContain('onChange={(e) => handleDescriptionInput(e.currentTarget.value)}');
    expect(source).toContain('onChange={(e) => handleSlugDraftInput(e.currentTarget.value)}');
    expect(source).not.toContain('onInput={(e) => handleDescriptionInput((e.target as HTMLTextAreaElement).value)}');
    expect(source).not.toContain('onInput={(e) => handleSlugDraftInput((e.target as HTMLInputElement).value)}');
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

  it("keeps pending item recovery active until the editor surface is actually ready", () => {
    const source = readSource("app/app/(dashboard)/site/[id]/domain/[domainKey]/item/[postId]/page.tsx");
    const hydrationSource = readSource("components/admin/pending-admin-item-hydration.tsx");

    expect(source).toContain("ReplaceAdminItemUrlInPlace");
    expect(source).not.toContain("NormalizeAdminItemUrl");
    expect(source).toContain(
      "{isPendingHydration ? <ReplaceAdminItemUrlInPlace canonicalPath={canonicalPath} waitForEditorReady /> : null}",
    );
    expect(hydrationSource).toContain("function isAdminEditorSurfaceReady()");
    expect(hydrationSource).toContain('document.querySelector(\'input[placeholder=\"Title\"]\')');
    expect(hydrationSource).toContain("if (isAdminEditorSurfaceReady()) {");
    expect(hydrationSource).toContain("router.refresh();");
    expect(hydrationSource).toContain("window.location.reload();");
    expect(hydrationSource).toContain("const normalizedCurrentPathname = normalizeAdminPathname(currentUrl.pathname);");
    expect(hydrationSource).toContain("const normalizedTargetPathname = normalizeAdminPathname(targetUrl.pathname);");
    expect(hydrationSource).toContain("const nextPath = `${currentUrl.pathname}${targetUrl.search}${targetUrl.hash}`;");
  });
});
