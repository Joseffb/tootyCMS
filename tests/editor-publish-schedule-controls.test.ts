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
    expect(source).toContain("const applyDataUpdate = (updater: SetStateAction<PostWithSite>) => {");
    expect(source).toContain("const handleTitleInput = (value: string) => {");
    expect(source).toContain('if ((current.title ?? "") === value && titleValueRef.current === value) {');
    expect(source).toContain("titleValueRef.current = value;");
    expect(source).toContain("const current = dataRef.current;");
    expect(source).toContain("const nextData = { ...current, title: value };");
    expect(source).toContain("applyDataUpdate(nextData);");
    expect(source).toContain("const handleDescriptionInput = (value: string) => {");
    expect(source).toContain("descriptionValueRef.current = value;");
    expect(source).toContain("applyDataUpdate((prev) => ({ ...prev, description: value }));");
    expect(source).toContain("const handleSlugDraftInput = (value: string) => {");
    expect(source).toContain("const nextSlugDraft = normalizeSlugDraft(value);");
    expect(source).toContain("slugValueRef.current = nextSlugDraft;");
    expect(source).toContain("applyDataUpdate((prev) => ({ ...prev, slug: nextSlugDraft }));");
    expect(source).toContain("const handleSlugCommit = (value: string) => {");
    expect(source).toContain("const nextSlug = normalizeSeoSlug(value);");
    expect(source).toContain("slugValueRef.current = nextSlug;");
    expect(source).toContain("applyDataUpdate((current) => ({ ...current, slug: nextSlug }));");
    expect(source).toContain('onInput={(e) => handleTitleInput((e.currentTarget as HTMLInputElement).value)}');
    expect(source).toContain("onChange={(e) => handleTitleInput(e.currentTarget.value)}");
    expect(source).toContain("onChange={(e) => handleDescriptionInput(e.currentTarget.value)}");
    expect(source).toContain("onChange={(e) => handleSlugDraftInput(e.currentTarget.value)}");
    expect(source).not.toContain('onInput={(e) => handleDescriptionInput((e.target as HTMLTextAreaElement).value)}');
    expect(source).not.toContain('onInput={(e) => handleSlugDraftInput((e.target as HTMLInputElement).value)}');
    expect(source).toContain("onBlur={(e) => handleSlugCommit(e.currentTarget.value)}");
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
    expect(source).toContain("applyDataUpdate((prev) => ({ ...prev, published: nextPublished }));");
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
      'const isEditorMutationPending = saveStatus === "saving" || isPendingPublishAction || isPendingPublishSchedule;',
    );
    expect(source).toContain('disabled={isEditorMutationPending}');
    expect(source).toContain('disabled={isEditorMutationPending || !canPublish}');
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

  it("stages taxonomy selections locally and leaves persistence to the normal autosave and explicit save flow", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const skipNextAutosaveRef = useRef(false);");
    expect(source).toContain("const toggleTaxonomyTerm = (taxonomy: string, termId: number) => {");
    expect(source).toContain("    updateSelectedTermsByTaxonomy((prev) => {");
    expect(source).not.toContain("    }, true);");
    expect(source).toContain("if (skipNextAutosaveRef.current) {");
    expect(source).toContain("skipNextAutosaveRef.current = false;");
  });

  it("creates taxonomy terms without forcing a second immediate taxonomy save path", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("updateSelectedTermsByTaxonomy((prev) => {");
    expect(source).not.toContain("        }, true);");
    expect(source).toContain("const buildSaveSnapshot = (snapshot?: EditorSaveSnapshot) => {");
  });

  it("builds immediate save payloads from current React state instead of lagging refs", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const latest = snapshot?.data ?? dataRef.current ?? data;");
    expect(source).toContain(
      "const selectedTerms = snapshot?.selectedTermsByTaxonomy ?? selectedTermsByTaxonomyRef.current;",
    );
    expect(source).toContain("const nextMetaEntries = snapshot?.metaEntries ?? metaEntriesRef.current;");
    expect(source).toContain("const hasMountedTitleField = titleInputRef.current != null;");
    expect(source).toContain("const hasMountedDescriptionField = descriptionInputRef.current != null;");
    expect(source).toContain("const hasMountedSlugField = slugInputRef.current != null;");
    expect(source).toContain("const liveTitleValue = titleInputRef.current?.value ?? \"\";");
    expect(source).toContain("const liveDescriptionValue = descriptionInputRef.current?.value ?? \"\";");
    expect(source).toContain("const liveSlugValue = slugInputRef.current?.value ?? \"\";");
    expect(source).toContain("const nextTitle = hasMountedTitleField ? liveTitleValue : titleValueRef.current || latest.title || \"\";");
    expect(source).toContain("const nextDescription = hasMountedDescriptionField");
    expect(source).toContain("? liveDescriptionValue");
    expect(source).toContain(": descriptionValueRef.current || latest.description || \"\";");
    expect(source).toContain("const nextSlug = normalizeSeoSlug(");
    expect(source).toContain("hasMountedSlugField ? liveSlugValue : slugValueRef.current || latest.slug || \"\",");
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

  it("eager-loads full core editorial taxonomy lists for categories and tags instead of relying on preview pagination", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('const shouldEagerLoadTaxonomyTerms = (taxonomy: string) => taxonomy === "category" || taxonomy === "tag";');
    expect(source).toContain("const loadTaxonomyTermsWithRetry = async (taxonomy: string) => {");
    expect(source).toContain("const attempts = shouldEagerLoadTaxonomyTerms(taxonomy) ? 18 : 4;");
    expect(source).toContain("const preview = await loadTaxonomyTermsWithRetry(row.taxonomy);");
    expect(source).toContain("setTaxonomyExpanded((prev) => ({ ...prev, [row.taxonomy]: true }));");
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
