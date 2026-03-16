import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("editor publish schedule controls", () => {
  it("closes the schedule dialog immediately on submit but does not auto-reopen it on async failure", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );
    const handlerStart = source.indexOf("const saveScheduledPublishAt =");
    const handlerEnd = source.indexOf("const handleThumbnailUpload =");
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain('setPublishScheduleDialogOpen(false);');
    expect(handler).toContain('toast.success(normalized ? "Scheduled publish time updated." : "Scheduled publish cleared.");');
    expect(handler).not.toContain('setPublishScheduleDialogOpen(true);');
  });

  it("renders the schedule dialog on an opaque system surface instead of a transparent overlay shell", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('DialogContent className="max-w-md border-stone-200 bg-white text-stone-900 shadow-2xl"');
  });

  it("uses an opaque dialog base surface instead of relying on theme background variables", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/tailwind/ui/dialog.tsx"),
      "utf8",
    );

    expect(source).toContain("bg-white text-stone-900");
    expect(source).toContain("dark:bg-stone-950 dark:text-white");
  });

  it("keeps the publish control labeled while pending for accessibility and lifecycle automation", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const publishButtonLabel = data.published ? \"Unpublish\" : \"Publish\";");
    expect(source).toContain("aria-label={publishButtonLabel}");
    expect(source).toContain('<span className=\"sr-only\">{publishButtonLabel}</span>');
  });

  it("gives the schedule button a distinct accessible name from the publish action", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('const scheduleButtonAriaLabel = scheduleButtonLabel.replace(/^Publish:/, "Schedule publish:");');
    expect(source).toContain("aria-label={scheduleButtonAriaLabel}");
  });

  it("updates core editor fields with functional state setters to avoid dropping title and slug edits", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );
    const textInputSource = readFileSync(
      path.join(process.cwd(), "lib/editor-text-input.ts"),
      "utf8",
    );

    expect(source).toContain("function isPlaceholderServerDraft(input: {");
    expect(source).toContain("const effectivePost = shouldUseCachedEditorState");
    expect(source).toContain("const shouldPreferCachedDraftOverPlaceholderServer =");
    expect(source).toContain("const shouldPreferCachedEditorStateForIncompleteServer =");
    expect(source).toContain("const cacheIsFreshEnoughForIncompleteServer =");
    expect(source).toContain("cachedSelectedTermCount > serverSelectedTermCount ||");
    expect(source).toContain("cachedVisibleMetaCount > serverVisibleMetaCount");
    expect(source).toContain("isPlaceholderServerDraft({");
    expect(source).toContain("cachedCompletenessScore > serverCompletenessScore &&");
    expect(source).toContain("setData(effectivePost);");
    expect(source).toContain("type ApplyDataUpdateOptions = {");
    expect(source).toContain("const applyDataUpdate = (");
    expect(textInputSource).toContain("export function shouldAcceptEditorTextFieldMutation");
    expect(textInputSource).toContain("export function shouldAcceptEditorTextFieldCommit");
    expect(source).toContain("const markTextFieldGesture = (field: \"title\" | \"description\" | \"slug\" | \"password\") => {");
    expect(source).toContain("const handleTitleInput = (value: string, nativeEvent?: Event | null) => {");
    expect(source).toContain("shouldAcceptEditorTextFieldMutation({");
    expect(source).toContain("recentGestureAt: lastFieldGestureAtRef.current.title,");
    expect(source).toContain("titleValueRef.current = value;");
    expect(source).toContain("const current = dataRef.current;");
    expect(source).toContain("const nextData = { ...current, title: value };");
    expect(source).toContain('applyDataUpdate(nextData, { markDirty: true, reason: "field:title", userMutation: true });');
    expect(source).toContain("const handleDescriptionInput = (value: string, nativeEvent?: Event | null) => {");
    expect(source).toContain("descriptionValueRef.current = value;");
    expect(source).toContain("recentGestureAt: lastFieldGestureAtRef.current.description,");
    expect(source).toContain('reason: "field:description",');
    expect(source).toContain("const handleSlugDraftInput = (value: string, nativeEvent?: Event | null) => {");
    expect(source).toContain("const nextSlugDraft = normalizeSlugDraft(value);");
    expect(source).toContain("slugValueRef.current = nextSlugDraft;");
    expect(source).toContain("recentGestureAt: lastFieldGestureAtRef.current.slug,");
    expect(source).toContain('reason: "field:slug:draft",');
    expect(source).toContain("const handleSlugCommit = (value: string, nativeEvent?: Event | null) => {");
    expect(source).toContain("const nextSlug = normalizeSeoSlug(value);");
    expect(source).toContain("shouldAcceptEditorTextFieldCommit({");
    expect(source).toContain('reason: "field:slug:commit",');
    expect(source).toContain('onPointerDown={() => markTextFieldGesture("title")}');
    expect(source).toContain('onKeyDown={() => markTextFieldGesture("title")}');
    expect(source).toContain('onPaste={() => markTextFieldGesture("title")}');
    expect(source).toContain('onInput={(e) => handleTitleInput((e.currentTarget as HTMLInputElement).value, e.nativeEvent)}');
    expect(source).not.toContain("onChange={(e) => handleTitleInput(e.currentTarget.value)}");
    expect(source).toContain('onPointerDown={() => markTextFieldGesture("description")}');
    expect(source).toContain('onInput={(e) => handleDescriptionInput(e.currentTarget.value, e.nativeEvent)}');
    expect(source).not.toContain("onChange={(e) => handleDescriptionInput(e.currentTarget.value)}");
    expect(source).toContain('onPointerDown={() => markTextFieldGesture("slug")}');
    expect(source).toContain('onInput={(e) => handleSlugDraftInput(e.currentTarget.value, e.nativeEvent)}');
    expect(source).not.toContain("onChange={(e) => handleSlugDraftInput(e.currentTarget.value)}");
    expect(source).toContain("onBlur={(e) => handleSlugCommit(e.currentTarget.value, e.nativeEvent)}");
  });

  it("persists scheduled publish through the dedicated hidden-meta action instead of the generic autosave queue", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('formData.append("publishAt", normalized ?? "");');
    expect(source).toContain("await onUpdateMetadata(formData, post.id, HIDDEN_PUBLISH_AT_META_KEY);");
    expect(source).toContain("const nextPublishAt =");
    expect(source).toContain("const nextPublished =");
    expect(source).toContain("skipNextAutosaveRef.current = true;");
    expect(source).toContain("const nextPost = { ...dataRef.current, published: nextPublished };");
    expect(source).toContain("applyDataUpdate(nextPost);");
    expect(source).toContain("syncEditorSessionSnapshot(nextPost, nextMetaEntries);");
  });

  it("flushes editor persistence before changing publish state or publish schedule", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('const persisted = await saveNow();');
    expect(source).toContain('throw new Error("Save your entry successfully before updating the publish schedule.");');
    expect(source).toContain('throw new Error("Save your entry successfully before changing publish status.");');
  });

  it("writes schedule and publish mutations into the editor session snapshot so reloads do not resurrect stale hidden meta", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const EDITOR_SESSION_CACHE_VERSION = 5;");
    expect(source).toContain("window.sessionStorage.removeItem(cacheKey);");
    expect(source).toContain("if (parsed.dirty !== true) {");
    expect(source).toContain("published: boolean;");
    expect(source).toContain("function buildEditorStateSignature(input: {");
    expect(source).toContain("published: Boolean(post.published),");
    expect(source).toContain("const syncEditorSessionSnapshot = (nextPost: PostWithSite, nextMetaEntries: PostMetaEntry[]) => {");
    expect(source).toContain("clearEditorSessionCache(nextPost.id);");
    expect(source).toContain("syncEditorSessionSnapshot(nextPost, nextMetaEntries);");
  });

  it("treats explicit save on an unchanged editor snapshot as an immediate saved no-op", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("if (signature === lastSavedSignatureRef.current) {");
    expect(source).toContain('setSaveStatus("saved");');
    expect(source).toContain("setSaveError(null);");
    expect(source).toContain("return true;");
  });

  it("does not immediately re-dirty the editor when persisted save state is reconciled back into React", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("// Persisted state reconciliation should not immediately re-dirty the editor.");
    expect(source).toContain("skipNextAutosaveRef.current = true;");
    expect(source).toContain("dataRef.current = nextPost;");
    expect(source).toContain("setData(nextPost);");
  });

  it("waits for taxonomy creation before saving instead of locking the editor behind a pending taxonomy label", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('const [pendingTaxonomyWrites, setPendingTaxonomyWrites] = useState<Record<string, number>>({});');
    expect(source).toContain("const pendingTaxonomyTasksRef = useRef(new Set<Promise<void>>());");
    expect(source).toContain("const waitForPendingTaxonomyWrites = async () => {");
    expect(source).toContain("await Promise.allSettled(Array.from(pendingTaxonomyTasksRef.current));");
    expect(source).toContain("await waitForPendingTaxonomyWrites();");
    expect(source).toContain(
      "const isExplicitEditorActionPending =",
    );
    expect(source).toContain('disabled={isExplicitEditorActionPending}');
    expect(source).toContain('disabled={isExplicitEditorActionPending || !canPublish}');
    expect(source).not.toContain("Waiting for taxonomy...");
  });

  it("keeps taxonomy controls inside the sidebar row instead of stacking full width", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(source).toContain('grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto]');
    expect(source).toContain('className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"');
  });

  it("persists the active editor sidebar tab per post so taxonomy work does not drop back to Style after remounts", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('const EDITOR_SIDEBAR_TAB_KEY_PREFIX = "tooty.editor.sidebar-tab.v1:";');
    expect(source).toContain("function readEditorSidebarTab(postId: string): string | null {");
    expect(source).toContain("function writeEditorSidebarTab(postId: string, tabId: string) {");
    expect(source).toContain('const [sidebarTab, setSidebarTab] = useState<string>(() => readEditorSidebarTab(post.id) || "document");');
    expect(source).toContain("const storedSidebarTab = readEditorSidebarTab(post.id);");
    expect(source).toContain("writeEditorSidebarTab(post.id, sidebarTab);");
  });

  it("persists taxonomy selections directly through the editor save path", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const skipNextAutosaveRef = useRef(false);");
    expect(source).toContain("const persistSnapshotNow = async (snapshot?: EditorSaveSnapshot) => {");
    expect(source).toContain("const persistSelectedTermsByTaxonomy = (nextSelectedTermsByTaxonomy: Record<string, number[]>) => {");
    expect(source).toContain("void persistSnapshotNow({ selectedTermsByTaxonomy: nextSelectedTermsByTaxonomy });");
    expect(source).toContain("regardless of whether the item is still a temporary draft shell.");
    expect(source).toContain("const toggleTaxonomyTerm = (taxonomy: string, termId: number) => {");
    expect(source).toContain("const nextSelectedTermsByTaxonomy = updateSelectedTermsByTaxonomy((prev) => {");
    expect(source).toContain("persistSelectedTermsByTaxonomy(nextSelectedTermsByTaxonomy);");
    expect(source).toContain("if (skipNextAutosaveRef.current) {");
    expect(source).toContain("skipNextAutosaveRef.current = false;");
  });

  it("creates taxonomy terms and immediately persists the final taxonomy selection", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const nextSelectedTermsByTaxonomy = updateSelectedTermsByTaxonomy((prev) => {");
    expect(source).toContain("persistSelectedTermsByTaxonomy(nextSelectedTermsByTaxonomy);");
    expect(source).toContain("const buildSaveSnapshot = (snapshot?: EditorSaveSnapshot) => {");
    expect(source).toContain("const built = buildSaveSnapshot(snapshot);");
  });

  it("builds immediate save payloads from current React state instead of lagging refs", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const latest = snapshot?.data ?? dataRef.current ?? data;");
    expect(source).toContain("const selectedTerms = normalizeSelectedTermsByTaxonomy(");
    expect(source).toContain("snapshot?.selectedTermsByTaxonomy ?? selectedTermsByTaxonomyRef.current");
    expect(source).toContain("const nextMetaEntries = normalizeMetaEntriesForPersistence(snapshot?.metaEntries ?? metaEntriesRef.current);");
    expect(source).not.toContain("const hasMountedTitleField = titleInputRef.current != null;");
    expect(source).not.toContain("const hasMountedDescriptionField = descriptionInputRef.current != null;");
    expect(source).not.toContain("const hasMountedSlugField = slugInputRef.current != null;");
    expect(source).not.toContain("const liveTitleValue = titleInputRef.current?.value ?? \"\";");
    expect(source).not.toContain("const liveDescriptionValue = descriptionInputRef.current?.value ?? \"\";");
    expect(source).not.toContain("const liveSlugValue = slugInputRef.current?.value ?? \"\";");
    expect(source).toContain("const nextTitle = titleValueRef.current;");
    expect(source).toContain("const nextDescription = descriptionValueRef.current;");
    expect(source).toContain("const nextSlug = normalizeSeoSlug(");
    expect(source).toContain('const nextSlug = normalizeSeoSlug(slugValueRef.current || latest.slug || "");');
  });

  it("canonicalizes taxonomy and meta payloads before autosave signatures so save loops do not re-trigger on order churn", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("function normalizeSelectedTermsByTaxonomy(selected: Record<string, number[]>) {");
    expect(source).toContain("function normalizeMetaEntriesForPersistence(metaEntries: PostMetaEntry[]) {");
    expect(source).toContain("const selectedTermsDigest = useMemo(");
    expect(source).toContain("const metaEntriesDigest = useMemo(");
    expect(source).toContain("JSON.stringify(normalizeSelectedTermsByTaxonomy(selectedTermsByTaxonomy))");
    expect(source).toContain("JSON.stringify(normalizeMetaEntriesForPersistence(metaEntries))");
  });

  it("reads taxonomy selection input from a synchronized ref so fast fill-and-click interactions do not lose the typed value", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const taxonomyInputByKeyRef = useRef<Record<string, string>>({});");
    expect(source).toContain("const setTaxonomyInputValue = (taxonomy: string, value: string) => {");
    expect(source).toContain("const readTaxonomyInputValue = (taxonomy: string) =>");
    expect(source).toContain(
      'taxonomyInputRefs.current[taxonomy]?.value ?? taxonomyInputByKeyRef.current[taxonomy] ?? ""',
    );
    expect(source).toContain("void addOrSelectTaxonomyTerm(taxonomy, readTaxonomyInputValue(taxonomy));");
    expect(source).toContain("onClick={() => void addOrSelectTaxonomyTerm(taxonomy, readTaxonomyInputValue(taxonomy))}");
  });

  it("does not block taxonomy selection behind unrelated editor save flushes", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const addOrSelectTaxonomyTerm = async (taxonomy: string, rawName: string) => {");
    expect(source).not.toContain("await saveQueue.flush().catch(() => undefined);");
  });

  it("deduplicates in-flight taxonomy create/select requests so double submits do not strand the sidebar in Saving state", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const pendingTaxonomyRequestKeysRef = useRef(new Set<string>());");
    expect(source).toContain("const requestKey = `${taxonomy}:${trimmed.toLowerCase()}`;");
    expect(source).toContain("if (pendingTaxonomyRequestKeysRef.current.has(requestKey)) return;");
    expect(source).toContain("pendingTaxonomyRequestKeysRef.current.add(requestKey);");
    expect(source).toContain("pendingTaxonomyRequestKeysRef.current.delete(requestKey);");
  });

  it("creates taxonomy terms directly without redundant full-taxonomy preflight reads", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).not.toContain("const resolveExistingTaxonomyTerm = async (taxonomy: string, trimmed: string) => {");
    expect(source).not.toContain("const resolvedTerms = await getTaxonomyTerms(siteId, taxonomy);");
    expect(source).not.toContain("const mergeResolvedTaxonomyTerms = (taxonomy: string, resolvedTerms: TaxonomyTerm[]) => {");
    expect(source).toContain("const created = await createTaxonomyTerm({ siteId, taxonomy, label: trimmed });");
  });

  it("trusts server-seeded core editorial taxonomy lists and does not background-refetch them on persisted item pages", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );
    const referenceSource = readFileSync(
      path.join(process.cwd(), "lib/editor-reference-data.ts"),
      "utf8",
    );
    const taxonomyLoadingSource = readFileSync(
      path.join(process.cwd(), "lib/editor-taxonomy-loading.ts"),
      "utf8",
    );

    expect(source).toContain('import {');
    expect(source).toContain('isEagerEditorTaxonomy,');
    expect(referenceSource).toContain("taxonomyTermsByKey[row.taxonomy] = [];");
    expect(source).toContain("editorReferenceSeededFromServer");
    expect(source).toContain("Persisted item editors already receive eager taxonomy terms from the server.");
    expect(source).not.toContain("resolveEditorTaxonomyRetryAttempts(");
    expect(source).toContain("persistedItemEagerTaxonomiesSettled");
    expect(source).not.toContain("fetchEditorReferenceData(siteId)");
    expect(source).not.toContain("editorReferenceBootstrapStateRef");
    expect(taxonomyLoadingSource).toContain("buildEditorTaxonomyAutoloadState");
    expect(taxonomyLoadingSource).toContain("getEditorTaxonomiesNeedingAutoload");
  });

  it("keeps selected taxonomy terms out of the generic option list so selection clicks cannot toggle the same term off again", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const selectedTermIdSet = new Set(selectedTermIds);");
    expect(source).toContain("const availableTerms = sectionTerms.filter((term) => !selectedTermIdSet.has(term.id));");
    expect(source).toContain("{selectedTermIds.map((id) => {");
    expect(source).toContain("{availableTerms.map((term) => {");
    expect(source).not.toContain("const isSelected = selectedTermIds.includes(term.id);");
  });
});
