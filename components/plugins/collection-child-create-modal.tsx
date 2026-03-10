"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import MediaPickerField from "@/components/media/media-picker-field";
import CarouselCtaUrlField from "@/components/plugins/carousel-cta-url-field";

function humanizeValue(value: string) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

type Props = {
  siteId: string;
  siteSubdomain?: string;
  setId: string;
  setTitle: string;
  childLabel: string;
  closeHref: string;
  workflowStates: string[];
  saveAction: (formData: FormData) => Promise<string | null | undefined>;
};

export default function CollectionChildCreateModal({
  siteId,
  siteSubdomain = "",
  setId,
  setTitle,
  childLabel,
  closeHref,
  workflowStates,
  saveAction,
}: Props) {
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);

  function submit() {
    startTransition(async () => {
      if (!formRef.current) return;
      setStatus(`Saving ${childLabel.toLowerCase()}...`);
      const nextUrl = await saveAction(new FormData(formRef.current));
      if (!nextUrl) {
        setStatus(`Failed to save ${childLabel.toLowerCase()}.`);
        return;
      }
      window.location.assign(nextUrl);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-stone-300 bg-white p-6 shadow-2xl">
        <form ref={formRef}>
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="setId" value={setId} />

          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <label className="block px-2">
                <span className="sr-only">Title</span>
                <input
                  name="title"
                  required
                  placeholder={`New ${childLabel}`}
                  className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 font-cal text-3xl text-black outline-none focus:border-stone-300 focus:bg-stone-50"
                />
              </label>
              <p className="mt-2 px-2 text-sm text-stone-600">
                Create a new slide for the {setTitle} carousel.
              </p>
              <p className="mt-1 px-2 text-xs text-stone-500">{status || "\u00A0"}</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Status</div>
                <select
                  name="workflow_state"
                  defaultValue="published"
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
                >
                  {workflowStates.map((state) => (
                    <option key={state} value={state}>
                      {humanizeValue(state)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Sort Order</div>
                <input
                  name="sort_order"
                  type="number"
                  defaultValue="0"
                  className="w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  href={closeHref}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                >
                  Close
                </Link>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={submit}
                  className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Save {childLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
              <MediaPickerField
                siteId={siteId}
                name="media_id"
                label="Media Manager"
                allowUpload
                allowedMimePrefixes={["image/"]}
              />
            </div>

            <div className="space-y-4">
              <label className="grid gap-2 text-sm text-black">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Description</span>
                <textarea name="description" rows={10} className="rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
              </label>

              <label className="grid gap-2 text-sm text-black">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">CTA Text</span>
                <textarea name="cta_text" rows={3} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black" />
              </label>

              <label className="grid gap-2 text-sm text-black">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">CTA URL</span>
                <CarouselCtaUrlField
                  name="cta_url"
                  siteSubdomain={siteSubdomain}
                  rows={3}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black"
                />
              </label>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
