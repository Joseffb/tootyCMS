"use client";

import { useMemo, useState } from "react";
import { useMediaPicker } from "@/components/media/use-media-picker";

type Props = {
  siteId: string;
  name: string;
  label: string;
  initialValue?: string;
  initialMediaId?: string;
  initialLabel?: string;
  initialUrl?: string;
  allowUpload?: boolean;
  allowedMimePrefixes?: string[];
  valueMode?: "mediaId" | "url";
  companionMediaIdName?: string;
};

export default function MediaPickerField({
  siteId,
  name,
  label,
  initialValue = "",
  initialMediaId = "",
  initialLabel = "",
  initialUrl = "",
  allowUpload = true,
  allowedMimePrefixes = ["image/"],
  valueMode = "mediaId",
  companionMediaIdName,
}: Props) {
  const [mediaId, setMediaId] = useState(valueMode === "mediaId" ? initialValue : initialMediaId);
  const [mediaLabel, setMediaLabel] = useState(initialLabel);
  const [mediaUrl, setMediaUrl] = useState(
    valueMode === "url" ? initialValue || initialUrl : initialUrl,
  );
  const { openMediaPicker, mediaPickerElement } = useMediaPicker();

  const displayLabel = useMemo(
    () => mediaLabel || (mediaId ? `Media #${mediaId}` : "No media selected"),
    [mediaId, mediaLabel],
  );

  return (
    <>
      <div className="grid gap-2 text-sm text-black">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">{label}</span>
        {mediaUrl ? (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <img src={mediaUrl} alt={displayLabel} className="aspect-[4/3] h-auto w-full object-cover" />
          </div>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-stone-200 bg-white text-sm text-stone-400">
            No image selected
          </div>
        )}
        <input
          type="hidden"
          name={name}
          value={valueMode === "url" ? mediaUrl : mediaId}
        />
        {companionMediaIdName ? (
          <input type="hidden" name={companionMediaIdName} value={mediaId} />
        ) : null}
        <button
          type="button"
          onClick={() =>
            openMediaPicker({
              siteId,
              title: "Media Manager",
              mode: "pick",
              allowUpload,
              allowedMimePrefixes,
              selectedIds: mediaId ? [mediaId] : [],
              onSelect: (items) => {
                const next = items[0];
                if (!next) return;
                setMediaId(next.mediaId);
                setMediaLabel(next.label || "");
                setMediaUrl(next.url || "");
              },
            })
          }
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
        >
          Open Media Manager
        </button>
        {mediaId || mediaUrl ? (
          <button
            type="button"
            onClick={() => {
              setMediaId("");
              setMediaLabel("");
              setMediaUrl("");
            }}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
          >
            Clear Selection
          </button>
        ) : null}
        <p className="text-xs text-stone-600">{displayLabel}</p>
      </div>
      {mediaPickerElement}
    </>
  );
}
