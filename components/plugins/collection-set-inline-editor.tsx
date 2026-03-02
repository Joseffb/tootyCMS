"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

type SetState = {
  id: string;
  title: string;
  description: string;
  embedKey: string;
  workflowState: string;
};

type Props = {
  siteId: string;
  parentLabel: string;
  closeHref: string;
  workflowStates: string[];
  record: SetState;
  saveAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

function humanizeValue(value: string) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function inlineValue(value: string, fallback: string) {
  const text = String(value || "");
  return text.trim() ? text : fallback;
}

export default function CollectionSetInlineEditor({
  siteId,
  parentLabel,
  closeHref,
  workflowStates,
  record,
  saveAction,
  deleteAction,
}: Props) {
  const [draft, setDraft] = useState(record);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [status, setStatus] = useState("All changes saved.");
  const [isPending, startTransition] = useTransition();

  function commit(next: SetState, label: string) {
    setDraft(next);
    setStatus(`Saving ${label}...`);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("siteId", siteId);
      formData.set("setId", next.id);
      formData.set("title", next.title);
      formData.set("description", next.description);
      formData.set("embed_key", next.embedKey);
      formData.set("workflow_state", next.workflowState);
      try {
        await saveAction(formData);
        setStatus(`${label} saved.`);
      } catch {
        setStatus(`Failed to save ${label.toLowerCase()}.`);
      }
    });
  }

  function handleEditableBlur(
    field: keyof SetState,
    fallback: string,
    label: string,
  ) {
    return (event: React.FocusEvent<HTMLElement>) => {
      const normalized = (event.currentTarget.textContent || "").trim() || fallback;
      if (normalized === draft[field]) {
        event.currentTarget.textContent = inlineValue(draft[field], fallback);
        return;
      }
      const next = { ...draft, [field]: normalized };
      event.currentTarget.textContent = inlineValue(normalized, fallback);
      commit(next, label);
    };
  }

  async function submitDelete() {
    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("setId", draft.id);
    formData.set("confirm", deleteConfirm);
    await deleteAction(formData);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-cal text-xl text-stone-900 dark:text-white">Edit {parentLabel}</h3>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
              Click a value, change it, then tab or click away to save.
            </p>
          </div>
          <Link
            href={closeHref}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-stone-50 dark:border-stone-700 dark:bg-white dark:text-black"
          >
            Close
          </Link>
        </div>

        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-300">
          {isPending ? "Saving..." : status}
        </div>

        <div className="space-y-3">
          <div className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[160px_minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Title</div>
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={handleEditableBlur("title", draft.title || "Untitled", "Title")}
              className="min-h-8 rounded-md border border-transparent px-2 py-1 text-sm font-medium text-stone-900 outline-none focus:border-stone-300 focus:bg-stone-50 dark:text-white dark:focus:border-stone-700 dark:focus:bg-stone-950"
            >
              {inlineValue(draft.title, "Untitled")}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[160px_minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Placement</div>
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={handleEditableBlur("embedKey", draft.embedKey || "homepage", "Placement")}
              className="min-h-8 rounded-md border border-transparent px-2 py-1 text-sm text-stone-800 outline-none focus:border-stone-300 focus:bg-stone-50 dark:text-stone-100 dark:focus:border-stone-700 dark:focus:bg-stone-950"
            >
              {inlineValue(draft.embedKey, "homepage")}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[160px_minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Description</div>
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={handleEditableBlur("description", "", "Description")}
              className="min-h-12 rounded-md border border-transparent px-2 py-1 text-sm text-stone-800 outline-none focus:border-stone-300 focus:bg-stone-50 dark:text-stone-100 dark:focus:border-stone-700 dark:focus:bg-stone-950"
            >
              {inlineValue(draft.description, "Add a description")}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[160px_minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Workflow</div>
            <button
              type="button"
              onClick={() => {
                const currentIndex = workflowStates.indexOf(draft.workflowState);
                const nextState = workflowStates[(currentIndex + 1 + workflowStates.length) % workflowStates.length] || draft.workflowState;
                commit({ ...draft, workflowState: nextState }, "Workflow");
              }}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-stone-50 dark:border-stone-700 dark:bg-white dark:text-black"
            >
              {humanizeValue(draft.workflowState)}
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${draft.workflowState === "published" ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70 dark:bg-stone-600"}`}></span>
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Danger Zone</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            <span>Type delete to remove</span>
            <input
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              className="rounded-md border border-rose-200 px-2 py-1 dark:border-rose-800 dark:bg-black"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              void submitDelete();
            }}
            className="rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:hover:bg-rose-950/30"
          >
            Delete {parentLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
