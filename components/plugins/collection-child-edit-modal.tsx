"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useMediaPicker } from "@/components/media/use-media-picker";

type MediaOption = {
  id: number;
  label: string;
  url: string;
};

type SlideState = {
  id: string;
  title: string;
  description: string;
  image: string;
  workflowState: string;
  mediaId: string;
  ctaText: string;
  ctaUrl: string;
  sortOrder: string;
};

type Props = {
  siteId: string;
  siteSubdomain?: string;
  setId: string;
  childLabel: string;
  closeHref: string;
  workflowStates: string[];
  mediaItems: MediaOption[];
  slide: SlideState;
  saveAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

const IMAGE_URL_PLACEHOLDER = "Add an image URL";

function humanizeValue(value: string) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function displayValue(value: string, fallback: string) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeImageValue(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === IMAGE_URL_PLACEHOLDER) return "";
  return text;
}

function isPreviewableImageUrl(value: string) {
  const text = normalizeImageValue(value);
  if (!text) return false;
  return (
    text.startsWith("/") ||
    text.startsWith("http://") ||
    text.startsWith("https://") ||
    text.startsWith("data:") ||
    text.startsWith("blob:")
  );
}

function toDomainLabelSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTitleDomainValue(title: string) {
  const slug = toDomainLabelSlug(title);
  if (!slug) return "{domain}";
  if (slug === "main" || slug === "root" || slug === "home" || slug === "homepage") {
    return "{domain}";
  }
  return `${slug}.{domain}`;
}

export default function CollectionChildEditModal({
  siteId,
  siteSubdomain = "",
  setId,
  childLabel,
  closeHref,
  workflowStates,
  mediaItems,
  slide,
  saveAction,
  deleteAction,
}: Props) {
  const [draft, setDraft] = useState<SlideState>(() => ({
    ...slide,
    image: normalizeImageValue(slide.image),
  }));
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [status, setStatus] = useState("All changes saved.");
  const [isPending, startTransition] = useTransition();
  const { openMediaPicker, mediaPickerElement } = useMediaPicker();
  const router = useRouter();

  function commit(next: SlideState, label: string) {
    setDraft(next);
    setStatus(`Saving ${label}...`);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("siteId", siteId);
      formData.set("setId", setId);
      formData.set("slideId", next.id);
      formData.set("title", next.title);
      formData.set("description", next.description);
      formData.set("image", next.image);
      formData.set("media_id", next.mediaId);
      formData.set("workflow_state", next.workflowState);
      formData.set("cta_text", next.ctaText);
      formData.set("cta_url", next.ctaUrl);
      formData.set("sort_order", next.sortOrder);
      try {
        await saveAction(formData);
        router.refresh();
        setStatus(`${label} saved.`);
      } catch {
        setStatus(`Failed to save ${label.toLowerCase()}.`);
      }
    });
  }

  function handleEditableBlur(
    field: keyof SlideState,
    fallback: string,
    label: string,
    sanitize?: (value: string) => string,
  ) {
    return (event: React.FocusEvent<HTMLElement>) => {
      const raw = event.currentTarget.textContent || "";
      const cleaned = sanitize ? sanitize(raw) : raw.trim();
      const nextValue = cleaned || fallback;
      if (nextValue === draft[field]) {
        event.currentTarget.textContent = displayValue(draft[field], fallback);
        return;
      }
      const next = { ...draft, [field]: nextValue };
      if (field === "title") {
        const prevTitleDomainValue = buildTitleDomainValue(draft.title);
        if (String(draft.ctaUrl || "").trim() === prevTitleDomainValue) {
          next.ctaUrl = buildTitleDomainValue(nextValue);
        }
      }
      event.currentTarget.textContent = displayValue(nextValue, fallback);
      commit(next, label);
    };
  }

  function adjustSort(delta: number) {
    const current = Number(draft.sortOrder || "0");
    const nextValue = String(Math.max(0, Number.isFinite(current) ? current + delta : 0));
    commit({ ...draft, sortOrder: nextValue }, "Sort Order");
  }

  function setCtaUrl(nextValue: string) {
    commit({ ...draft, ctaUrl: nextValue }, "CTA URL");
  }

  async function submitDelete() {
    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("setId", setId);
    formData.set("slideId", draft.id);
    formData.set("confirm", deleteConfirm);
    await deleteAction(formData);
  }

  const previewUrl =
    (isPreviewableImageUrl(draft.image) ? normalizeImageValue(draft.image) : "") ||
    mediaItems.find((item) => String(item.id) === draft.mediaId)?.url ||
    "";
  const titleDomainValue = buildTitleDomainValue(draft.title);
  const normalizedSiteSubdomain = String(siteSubdomain || "").trim().toLowerCase();
  const currentSubdomainValue =
    normalizedSiteSubdomain && normalizedSiteSubdomain !== "main"
      ? `${normalizedSiteSubdomain}.{domain}`
      : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-stone-300 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={handleEditableBlur("title", draft.title || "Untitled", "Title")}
              className="min-h-10 rounded-lg border border-transparent px-2 py-1 font-cal text-3xl text-black outline-none focus:border-stone-300 focus:bg-stone-50"
            >
              {displayValue(draft.title, "Untitled")}
            </div>
            <p className="mt-2 px-2 text-sm text-stone-600">
              Click a field to edit. Changes save automatically.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Status</div>
              <button
                type="button"
                onClick={() => {
                  const currentIndex = workflowStates.indexOf(draft.workflowState);
                  const nextState =
                    workflowStates[(currentIndex + 1 + workflowStates.length) % workflowStates.length] || draft.workflowState;
                  commit({ ...draft, workflowState: nextState }, "Status");
                }}
                className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
              >
                {humanizeValue(draft.workflowState)}
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${
                    draft.workflowState === "published"
                      ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                      : "bg-stone-300"
                  }`}
                ></span>
              </button>
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Sort Order</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustSort(-1)}
                  className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-semibold text-black"
                >
                  ↓
                </button>
                <input
                  value={draft.sortOrder}
                  onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                  onBlur={(event) => {
                    const parsed = Number(event.target.value.trim());
                    const nextValue = String(Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0);
                    if (nextValue !== draft.sortOrder) {
                      commit({ ...draft, sortOrder: nextValue }, "Sort Order");
                    } else {
                      setDraft((current) => ({ ...current, sortOrder: nextValue }));
                    }
                  }}
                  className="w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                />
                <button
                  type="button"
                  onClick={() => adjustSort(1)}
                  className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-semibold text-black"
                >
                  ↑
                </button>
              </div>
            </div>
            <Link
              href={closeHref}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
            >
              Close
            </Link>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
          {isPending ? "Saving..." : status}
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              {previewUrl ? (
                <img src={previewUrl} alt={draft.title || childLabel} className="aspect-[4/3] h-auto w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center text-sm text-stone-400">
                  No image selected
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Media Manager</div>
              <button
                type="button"
                onClick={() =>
                  openMediaPicker({
                    siteId,
                    title: "Media Manager",
                    mode: "pick",
                    allowUpload: true,
                    allowedMimePrefixes: ["image/"],
                    selectedIds: draft.mediaId ? [draft.mediaId] : [],
                    onSelect: (items) => {
                      const next = items[0];
                      if (!next) return;
                      commit(
                        {
                          ...draft,
                          mediaId: next.mediaId,
                          image: next.url || "",
                        },
                        "Media",
                      );
                    },
                  })
                }
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
              >
                Open Media Manager
              </button>
              {draft.mediaId ? (
                <p className="mt-2 text-xs text-stone-600">
                  Selected media: {mediaItems.find((item) => String(item.id) === draft.mediaId)?.label || `#${draft.mediaId}`}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Description</div>
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={handleEditableBlur("description", "", "Description")}
                className="min-h-52 rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm text-black outline-none focus:border-stone-300 focus:bg-stone-50"
              >
                {displayValue(draft.description, "Add a description")}
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">CTA Text</div>
              <textarea
                value={draft.ctaText}
                onChange={(event) => setDraft((current) => ({ ...current, ctaText: event.target.value }))}
                onBlur={(event) => {
                  if (event.target.value === draft.ctaText) return;
                  commit({ ...draft, ctaText: event.target.value }, "CTA Text");
                }}
                className="min-h-20 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black"
              />
            </div>

            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">CTA URL</div>
              <p className="mb-2 text-xs text-stone-600">
                Tip: use <code>{"{domain}"}</code> for root and <code>label.{"{domain}"}</code> for subdomains.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCtaUrl("{domain}")}
                  className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
                >
                  Root
                </button>
                {currentSubdomainValue ? (
                  <button
                    type="button"
                    onClick={() => setCtaUrl(currentSubdomainValue)}
                    className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
                  >
                    Current Sub
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setCtaUrl(titleDomainValue)}
                  className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
                >
                  Label.Root
                </button>
                <button
                  type="button"
                  onClick={() => setCtaUrl("https://")}
                  className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
                >
                  External
                </button>
              </div>
              <textarea
                value={draft.ctaUrl}
                onChange={(event) => setDraft((current) => ({ ...current, ctaUrl: event.target.value }))}
                onBlur={(event) => {
                  if (event.target.value === draft.ctaUrl) return;
                  commit({ ...draft, ctaUrl: event.target.value }, "CTA URL");
                }}
                className="min-h-20 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-rose-300 bg-rose-50">
          {deleteArmed ? (
            <div className="space-y-3 p-4">
              <div className="text-sm font-semibold text-rose-800">Delete this {childLabel.toLowerCase()}?</div>
              <label className="grid gap-1 text-xs text-rose-800">
                <span>Type delete to confirm</span>
                <input
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm text-black"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void submitDelete();
                  }}
                  className="rounded-md border border-rose-600 bg-rose-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteArmed(false);
                    setDeleteConfirm("");
                  }}
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteArmed(true)}
              className="block w-full px-4 py-4 text-left text-sm font-semibold text-rose-800"
            >
              Delete {childLabel}
            </button>
          )}
        </div>

        {mediaPickerElement}
      </div>
    </div>
  );
}
