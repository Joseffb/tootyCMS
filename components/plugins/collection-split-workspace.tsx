import Link from "next/link";
import MediaPickerField from "@/components/media/media-picker-field";
import CollectionOrderManager from "@/components/plugins/collection-order-manager";
import type {
  ExtensionSettingsField,
  PluginCollectionWorkspaceField,
} from "@/lib/extension-contracts";

type CollectionRecord = {
  id: string;
  title: string;
  description: string;
  handle: string;
  workflowState: string;
  meta: Record<string, string>;
};

type ChildRecord = {
  id: string;
  title: string;
  description: string;
  content: string;
  slug: string;
  workflowState: string;
  sortOrder: number;
  meta: Record<string, string>;
};

type NestedItemRecord = {
  id: string;
  title: string;
  summary: string;
  sortOrder: number;
  values: Record<string, string | boolean>;
};

type Props = {
  pluginId: string;
  siteId: string;
  parentLabel: string;
  childLabel: string;
  nestedSingularLabel: string;
  nestedPluralLabel: string;
  workflowStates: string[];
  collections: CollectionRecord[];
  selectedCollectionId: string;
  selectedCollection: CollectionRecord | null;
  childrenRecords: ChildRecord[];
  selectedChildId: string;
  selectedChild: ChildRecord | null;
  nestedItems: NestedItemRecord[];
  selectedNestedItemId: string;
  selectedNestedItem: NestedItemRecord | null;
  parentEditorFields: PluginCollectionWorkspaceField[];
  childEditorFields: PluginCollectionWorkspaceField[];
  nestedFields: ExtensionSettingsField[];
  samePageLink: string;
  crossPageLink: string;
  saveCollectionAction: (formData: FormData) => Promise<void>;
  deleteCollectionAction: (formData: FormData) => Promise<void>;
  saveChildAction: (formData: FormData) => Promise<void>;
  deleteChildAction: (formData: FormData) => Promise<void>;
  reorderChildrenAction: (formData: FormData) => Promise<void>;
  saveNestedItemAction: (formData: FormData) => Promise<void>;
  deleteNestedItemAction: (formData: FormData) => Promise<void>;
  reorderNestedItemsAction: (formData: FormData) => Promise<void>;
};

function humanizeValue(value: string) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function resolveFieldValue(
  field: PluginCollectionWorkspaceField,
  input: { meta: Record<string, string> },
) {
  if (field.target === "meta" && field.metaKey) {
    return String(input.meta[field.metaKey] || "");
  }
  return "";
}

function resolveNestedFieldValue(
  field: ExtensionSettingsField,
  values: Record<string, string | boolean>,
) {
  const value = values[field.key];
  if (field.type === "checkbox") return Boolean(value);
  return String(value ?? "");
}

function buildHref(
  pluginId: string,
  siteId: string,
  updates: Record<string, string | undefined>,
  selectedCollectionId: string,
  selectedChildId: string,
  selectedNestedItemId: string,
) {
  const params = new URLSearchParams();
  params.set("tab", "carousels");
  params.set("view", "split");
  params.set("siteId", siteId);
  if (selectedCollectionId) params.set("set", selectedCollectionId);
  if (selectedChildId) params.set("chapter", selectedChildId);
  if (selectedNestedItemId) params.set("artifact", selectedNestedItemId);
  for (const [key, value] of Object.entries(updates)) {
    if (!value) params.delete(key);
    else params.set(key, value);
  }
  return `/app/plugins/${pluginId}?${params.toString()}`;
}

function renderWorkspaceField(
  field: PluginCollectionWorkspaceField,
  value: string,
) {
  const fieldName = `field_${field.key}`;
  if (field.type === "textarea") {
    return (
      <textarea
        key={field.key}
        name={fieldName}
        defaultValue={value}
        rows={field.rows || 5}
        placeholder={field.placeholder || ""}
        className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black"
      />
    );
  }
  if (field.type === "checkbox") {
    return (
      <label key={field.key} className="inline-flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
        <input type="checkbox" name={fieldName} defaultChecked={value === "true"} className="h-4 w-4" />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <select
        key={field.key}
        name={fieldName}
        defaultValue={value || field.defaultValue || ""}
        className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black"
      >
        {(field.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      key={field.key}
      name={fieldName}
      defaultValue={value}
      placeholder={field.placeholder || ""}
      className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black"
    />
  );
}

function renderNestedField(
  field: ExtensionSettingsField,
  value: string | boolean,
  siteId: string,
) {
  const fieldName = `item_${field.key}`;
  if (field.type === "textarea") {
    return (
      <textarea
        key={field.key}
        name={fieldName}
        defaultValue={String(value ?? "")}
        rows={field.rows || 5}
        placeholder={field.placeholder || ""}
        className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black"
      />
    );
  }
  if (field.type === "checkbox") {
    return <input key={field.key} type="checkbox" name={fieldName} defaultChecked={Boolean(value)} className="h-4 w-4" />;
  }
  if (field.type === "select") {
    return (
      <select
        key={field.key}
        name={fieldName}
        defaultValue={String(value ?? field.defaultValue ?? "")}
        className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black"
      >
        {(field.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "media") {
    return (
      <MediaPickerField
        key={field.key}
        siteId={siteId}
        name={fieldName}
        label={field.label}
        initialValue={String(value ?? "")}
        allowUpload
        allowedMimePrefixes={["audio/", "video/"]}
      />
    );
  }
  return (
    <input
      key={field.key}
      name={fieldName}
      defaultValue={String(value ?? "")}
      placeholder={field.placeholder || ""}
      className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black"
    />
  );
}

export default function CollectionSplitWorkspace({
  pluginId,
  siteId,
  parentLabel,
  childLabel,
  nestedSingularLabel,
  nestedPluralLabel,
  workflowStates,
  collections,
  selectedCollectionId,
  selectedCollection,
  childrenRecords,
  selectedChildId,
  selectedChild,
  nestedItems,
  selectedNestedItemId,
  selectedNestedItem,
  parentEditorFields,
  childEditorFields,
  nestedFields,
  samePageLink,
  crossPageLink,
  saveCollectionAction,
  deleteCollectionAction,
  saveChildAction,
  deleteChildAction,
  reorderChildrenAction,
  saveNestedItemAction,
  deleteNestedItemAction,
  reorderNestedItemsAction,
}: Props) {
  const baseCollectionHref = (updates: Record<string, string | undefined>) =>
    buildHref(pluginId, siteId, updates, selectedCollectionId, selectedChildId, selectedNestedItemId);
  const editor = selectedNestedItemId
    ? "artifact"
    : selectedChildId
      ? "chapter"
      : selectedCollectionId
        ? "story"
        : "";

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-cal text-xl text-stone-900">{parentLabel}s</h2>
              <p className="text-xs text-stone-500">Select a story, then manage its chapters and artifacts.</p>
            </div>
            <Link
              href={baseCollectionHref({ set: "new", chapter: undefined, artifact: undefined })}
              className="rounded-full border border-black bg-black px-3 py-2 text-xs font-semibold text-white"
            >
              Add {parentLabel}
            </Link>
          </div>
          <div className="grid gap-2">
            {collections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-5 text-sm text-stone-500">
                No {parentLabel.toLowerCase()}s yet.
              </div>
            ) : (
              collections.map((entry) => {
                const active = entry.id === selectedCollectionId;
                return (
                  <Link
                    key={entry.id}
                    href={baseCollectionHref({ set: entry.id, chapter: undefined, artifact: undefined })}
                    className={`rounded-2xl border px-4 py-3 text-left ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-stone-200 bg-stone-50 text-stone-900"
                    }`}
                  >
                    <div className="text-sm font-semibold">{entry.title || entry.handle || "Untitled"}</div>
                    <div className={`mt-1 text-xs ${active ? "text-stone-300" : "text-stone-500"}`}>
                      {entry.description || entry.handle || humanizeValue(entry.workflowState)}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {selectedCollection ? (
          <div className="space-y-3 border-t border-stone-200 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-cal text-lg text-stone-900">{childLabel}s</h3>
                <p className="text-xs text-stone-500">Drag to reorder the chapter sequence.</p>
              </div>
              <Link
                href={baseCollectionHref({ chapter: "new", artifact: undefined })}
                className="rounded-full border border-stone-900 px-3 py-2 text-xs font-semibold text-stone-900"
              >
                Add {childLabel}
              </Link>
            </div>
            <CollectionOrderManager
              siteId={siteId}
              items={childrenRecords.map((entry) => ({
                id: entry.id,
                title: entry.title || "Untitled",
                sortOrder: entry.sortOrder,
                status: humanizeValue(entry.workflowState),
                editHref: baseCollectionHref({ chapter: entry.id, artifact: undefined }),
              }))}
              saveOrderAction={reorderChildrenAction}
              extraFormData={{ setId: selectedCollection.id }}
              title={`${childLabel} Order`}
            />
          </div>
        ) : null}

        {selectedChild ? (
          <div className="space-y-3 border-t border-stone-200 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-cal text-lg text-stone-900">{nestedPluralLabel}</h3>
                <p className="text-xs text-stone-500">Drag to reorder story artifacts inside this chapter.</p>
              </div>
              <Link
                href={baseCollectionHref({ artifact: "new" })}
                className="rounded-full border border-stone-900 px-3 py-2 text-xs font-semibold text-stone-900"
              >
                Add {nestedSingularLabel}
              </Link>
            </div>
            <CollectionOrderManager
              siteId={siteId}
              items={nestedItems.map((entry) => ({
                id: entry.id,
                title: entry.title || "Untitled",
                sortOrder: entry.sortOrder,
                status: entry.summary,
                editHref: baseCollectionHref({ artifact: entry.id }),
              }))}
              saveOrderAction={reorderNestedItemsAction}
              extraFormData={{ setId: selectedCollection?.id || "", chapterId: selectedChild.id }}
              title={`${nestedSingularLabel} Order`}
            />
          </div>
        ) : null}
      </aside>

      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        {selectedCollectionId === "new" ? (
          <form action={saveCollectionAction} className="space-y-5">
            <input type="hidden" name="siteId" value={siteId} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">New {parentLabel}</p>
              <h2 className="mt-2 font-cal text-3xl text-stone-900">Create a new {parentLabel.toLowerCase()}</h2>
            </div>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Title</span>
              <input name="title" required className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Description</span>
              <textarea name="description" rows={4} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Story Key</span>
              <input name="embed_key" className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
            </label>
            {parentEditorFields.map((field) => (
              <label key={field.key} className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">{field.label}</span>
                {renderWorkspaceField(field, "")}
                {field.helpText ? <span className="text-xs text-stone-500">{field.helpText}</span> : null}
              </label>
            ))}
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Workflow</span>
              <select name="workflow_state" defaultValue="draft" className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
                {workflowStates.map((state) => (
                  <option key={state} value={state}>
                    {humanizeValue(state)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
              Save {parentLabel}
            </button>
          </form>
        ) : selectedCollection && editor === "story" ? (
          <div className="space-y-6">
            <form action={saveCollectionAction} className="space-y-5">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="setId" value={selectedCollection.id} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{parentLabel}</p>
                <h2 className="mt-2 font-cal text-3xl text-stone-900">{selectedCollection.title || "Untitled"}</h2>
              </div>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Title</span>
                <input name="title" defaultValue={selectedCollection.title} required className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Description</span>
                <textarea name="description" defaultValue={selectedCollection.description} rows={4} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Story Key</span>
                <input name="embed_key" defaultValue={selectedCollection.handle} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              {parentEditorFields.map((field) => (
                <label key={field.key} className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">{field.label}</span>
                  {renderWorkspaceField(field, resolveFieldValue(field, selectedCollection))}
                  {field.helpText ? <span className="text-xs text-stone-500">{field.helpText}</span> : null}
                </label>
              ))}
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Workflow</span>
                <select name="workflow_state" defaultValue={selectedCollection.workflowState} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
                  {workflowStates.map((state) => (
                    <option key={state} value={state}>
                      {humanizeValue(state)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-3">
                <button type="submit" className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
                  Save {parentLabel}
                </button>
                <Link href={baseCollectionHref({ chapter: undefined, artifact: undefined })} className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">
                  Close
                </Link>
              </div>
            </form>
            <form action={deleteCollectionAction} className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="setId" value={selectedCollection.id} />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Danger Zone</p>
              <label className="grid gap-2">
                <span className="text-sm text-rose-900">Type delete to remove this {parentLabel.toLowerCase()} and its {childLabel.toLowerCase()}s.</span>
                <input name="confirm" className="rounded-xl border border-rose-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <button type="submit" className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700">
                Delete {parentLabel}
              </button>
            </form>
          </div>
        ) : selectedChildId === "new" && selectedCollection ? (
          <form action={saveChildAction} className="space-y-5">
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="setId" value={selectedCollection.id} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">New {childLabel}</p>
              <h2 className="mt-2 font-cal text-3xl text-stone-900">Create a chapter for {selectedCollection.title || selectedCollection.handle}</h2>
            </div>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Title</span>
              <input name="title" required className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Summary</span>
              <textarea name="description" rows={4} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Chapter Text</span>
              <textarea name="content" rows={16} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
            </label>
            {childEditorFields.map((field) => (
              <label key={field.key} className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">{field.label}</span>
                {renderWorkspaceField(field, "")}
                {field.helpText ? <span className="text-xs text-stone-500">{field.helpText}</span> : null}
              </label>
            ))}
            <div className="grid gap-5 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Workflow</span>
                <select name="workflow_state" defaultValue="draft" className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
                  {workflowStates.map((state) => (
                    <option key={state} value={state}>
                      {humanizeValue(state)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Sort Order</span>
                <input name="sort_order" type="number" defaultValue="0" className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
            </div>
            <button type="submit" className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
              Save {childLabel}
            </button>
          </form>
        ) : selectedChild && editor === "chapter" ? (
          <div className="space-y-6">
            <form action={saveChildAction} className="space-y-5">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="setId" value={selectedCollection?.id || ""} />
              <input type="hidden" name="slideId" value={selectedChild.id} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{childLabel}</p>
                <h2 className="mt-2 font-cal text-3xl text-stone-900">{selectedChild.title || "Untitled"}</h2>
              </div>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Title</span>
                <input name="title" defaultValue={selectedChild.title} required className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Summary</span>
                <textarea name="description" defaultValue={selectedChild.description} rows={4} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Chapter Text</span>
                <textarea name="content" defaultValue={selectedChild.content} rows={18} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              {childEditorFields.map((field) => (
                <label key={field.key} className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">{field.label}</span>
                  {renderWorkspaceField(field, resolveFieldValue(field, selectedChild))}
                  {field.helpText ? <span className="text-xs text-stone-500">{field.helpText}</span> : null}
                </label>
              ))}
              <div className="grid gap-5 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Workflow</span>
                  <select name="workflow_state" defaultValue={selectedChild.workflowState} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
                    {workflowStates.map((state) => (
                      <option key={state} value={state}>
                        {humanizeValue(state)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Sort Order</span>
                  <input name="sort_order" type="number" defaultValue={String(selectedChild.sortOrder)} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="submit" className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
                  Save {childLabel}
                </button>
                <Link href={baseCollectionHref({ artifact: undefined })} className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">
                  Close
                </Link>
              </div>
            </form>
            <form action={deleteChildAction} className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="setId" value={selectedCollection?.id || ""} />
              <input type="hidden" name="slideId" value={selectedChild.id} />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Danger Zone</p>
              <label className="grid gap-2">
                <span className="text-sm text-rose-900">Type delete to remove this {childLabel.toLowerCase()} and its artifacts.</span>
                <input name="confirm" className="rounded-xl border border-rose-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <button type="submit" className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700">
                Delete {childLabel}
              </button>
            </form>
          </div>
        ) : selectedNestedItemId === "new" && selectedChild ? (
          <form action={saveNestedItemAction} className="space-y-5">
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="setId" value={selectedCollection?.id || ""} />
            <input type="hidden" name="chapterId" value={selectedChild.id} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">New {nestedSingularLabel}</p>
              <h2 className="mt-2 font-cal text-3xl text-stone-900">Add a new {nestedSingularLabel.toLowerCase()}</h2>
            </div>
            {nestedFields.map((field) => (
              <label key={field.key} className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">{field.label}</span>
                {field.type === "checkbox" ? (
                  <div className="inline-flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
                    {renderNestedField(field, false, siteId)}
                    <span>{field.helpText || field.label}</span>
                  </div>
                ) : (
                  renderNestedField(field, "", siteId)
                )}
                {field.helpText && field.type !== "checkbox" ? <span className="text-xs text-stone-500">{field.helpText}</span> : null}
              </label>
            ))}
            <button type="submit" className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
              Save {nestedSingularLabel}
            </button>
          </form>
        ) : selectedNestedItem && selectedChild ? (
          <div className="space-y-6">
            <form action={saveNestedItemAction} className="space-y-5">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="setId" value={selectedCollection?.id || ""} />
              <input type="hidden" name="chapterId" value={selectedChild.id} />
              <input type="hidden" name="itemId" value={selectedNestedItem.id} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{nestedSingularLabel}</p>
                <h2 className="mt-2 font-cal text-3xl text-stone-900">{selectedNestedItem.title || "Untitled"}</h2>
              </div>
              {nestedFields.map((field) => (
                <label key={field.key} className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">{field.label}</span>
                  {field.type === "checkbox" ? (
                    <div className="inline-flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-black">
                      {renderNestedField(field, resolveNestedFieldValue(field, selectedNestedItem.values), siteId)}
                      <span>{field.helpText || field.label}</span>
                    </div>
                  ) : (
                    renderNestedField(field, resolveNestedFieldValue(field, selectedNestedItem.values), siteId)
                  )}
                  {field.helpText && field.type !== "checkbox" ? <span className="text-xs text-stone-500">{field.helpText}</span> : null}
                </label>
              ))}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Same-page trigger</span>
                  <textarea readOnly value={samePageLink} rows={3} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-black" />
                </label>
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Cross-page trigger</span>
                  <textarea readOnly value={crossPageLink} rows={3} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-black" />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="submit" className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
                  Save {nestedSingularLabel}
                </button>
                <Link href={baseCollectionHref({ artifact: undefined })} className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">
                  Close
                </Link>
              </div>
            </form>
            <form action={deleteNestedItemAction} className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="setId" value={selectedCollection?.id || ""} />
              <input type="hidden" name="chapterId" value={selectedChild.id} />
              <input type="hidden" name="itemId" value={selectedNestedItem.id} />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Danger Zone</p>
              <label className="grid gap-2">
                <span className="text-sm text-rose-900">Type delete to remove this {nestedSingularLabel.toLowerCase()}.</span>
                <input name="confirm" className="rounded-xl border border-rose-200 bg-white px-3 py-3 text-sm text-black" />
              </label>
              <button type="submit" className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700">
                Delete {nestedSingularLabel}
              </button>
            </form>
          </div>
        ) : (
          <div className="flex min-h-[24rem] items-center justify-center rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-6 text-center text-sm text-stone-500">
            Select a {parentLabel.toLowerCase()}, {childLabel.toLowerCase()}, or {nestedSingularLabel.toLowerCase()} from the rail to edit it here.
          </div>
        )}
      </section>
    </div>
  );
}
