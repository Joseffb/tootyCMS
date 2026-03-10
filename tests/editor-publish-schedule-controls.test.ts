import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("editor publish schedule controls", () => {
  it("closes the schedule dialog before waiting on the async save path", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('setPublishScheduleDialogOpen(false);');
    expect(source).toContain('toast.success(normalized ? "Scheduled publish time updated." : "Scheduled publish cleared.");');
    expect(source).toContain('setPublishScheduleDialogOpen(true);');
  });

  it("renders the schedule dialog on an opaque system surface instead of a transparent overlay shell", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('DialogContent className="max-w-md border-stone-200 bg-white text-stone-900 shadow-2xl dark:border-stone-700 dark:bg-stone-950 dark:text-white"');
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

    expect(source).toContain("const effectivePost = shouldUseCachedEditorState");
    expect(source).toContain("setData(effectivePost);");
    expect(source).toContain("const applyDataUpdate = (updater: SetStateAction<PostWithSite>) => {");
    expect(source).toContain('onChange={(e) => applyDataUpdate((prev) => ({ ...prev, title: e.target.value }))}');
    expect(source).toContain('onChange={(e) => applyDataUpdate((prev) => ({ ...prev, description: e.target.value }))}');
    expect(source).toContain('onChange={(e) => applyDataUpdate((prev) => ({ ...prev, slug: normalizeSlugDraft(e.target.value) }))}');
  });

  it("updates the scheduled publish label optimistically before the async metadata write completes", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const previousMetaEntries = metaEntriesRef.current;");
    expect(source).toContain("setMetaEntries(nextMetaEntries);");
    expect(source).toContain("setMetaEntries(previousMetaEntries);");
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
    expect(source).toContain('disabled={saveStatus === "saving"}');
    expect(source).toContain('disabled={isPendingPublishAction || !canPublish}');
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

  it("does not force immediate autosave while taxonomy selections are still settling", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const toggleTaxonomyTerm = (taxonomy: string, termId: number) => {");
    expect(source).toContain("    enqueueSave(false, { selectedTermsByTaxonomy: next });");
    expect(source).toContain("    const next = updateSelectedTermsByTaxonomy((prev) => {");
    expect(source).not.toContain("    }, true);\n    enqueueSave();");
  });

  it("enqueues taxonomy saves against the exact next taxonomy snapshot instead of waiting for ref synchronization", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("const nextSelectedTermsByTaxonomy = updateSelectedTermsByTaxonomy((prev) => {");
    expect(source).toContain("enqueueSave(false, { selectedTermsByTaxonomy: nextSelectedTermsByTaxonomy });");
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

  it("does a single storage read before creating taxonomy terms instead of retrying for tens of seconds", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).not.toContain("const resolveExistingTaxonomyTerm = async (taxonomy: string, trimmed: string) => {");
    expect(source).toContain("const resolvedTerms = await getTaxonomyTerms(siteId, taxonomy);");
    expect(source).toContain("const normalizedResolvedTerms = mergeResolvedTaxonomyTerms(taxonomy, resolvedTerms);");
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
