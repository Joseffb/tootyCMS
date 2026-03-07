"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useMediaPicker } from "@/components/media/use-media-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/tailwind/ui/dialog";
import {
  clampProfileCropOffset,
  createProfileCropSourceRect,
  getProfileCropBox,
  PROFILE_IMAGE_CROP_VIEWPORT,
  PROFILE_IMAGE_EXPORT_SIZE,
} from "@/lib/profile-image-crop";
import { uploadSmart } from "@/lib/uploadSmart";

type CropImageState = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  fileName: string;
  mimeType: string;
};

type CropState = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
};

type Props = {
  siteId?: string;
  initialValue?: string;
  displayName?: string;
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

function loadImageMetadata(src: string) {
  return new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = src;
  });
}

async function cropProfileImageToBlob(input: {
  image: CropImageState;
  crop: CropState;
}) {
  const image = new window.Image();
  image.src = input.image.src;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load crop image."));
  });

  const rect = createProfileCropSourceRect({
    naturalWidth: input.image.naturalWidth,
    naturalHeight: input.image.naturalHeight,
    width: input.crop.width,
    height: input.crop.height,
    offsetX: input.crop.offsetX,
    offsetY: input.crop.offsetY,
  });

  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_IMAGE_EXPORT_SIZE;
  canvas.height = PROFILE_IMAGE_EXPORT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Profile cropper is unavailable in this browser.");
  }

  context.drawImage(
    image,
    rect.sourceX,
    rect.sourceY,
    rect.sourceWidth,
    rect.sourceHeight,
    0,
    0,
    PROFILE_IMAGE_EXPORT_SIZE,
    PROFILE_IMAGE_EXPORT_SIZE,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export cropped image."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export default function ProfileImageField({
  siteId = "",
  initialValue = "",
  displayName = "Profile image",
}: Props) {
  const normalizedSiteId = String(siteId || "").trim();
  const canUpload = Boolean(normalizedSiteId);
  const [value, setValue] = useState(String(initialValue || "").trim());
  const [pendingImage, setPendingImage] = useState<CropImageState | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number } | null>(null);
  const { openMediaPicker, mediaPickerElement } = useMediaPicker();

  const previewAlt = useMemo(
    () => (displayName || "Profile image").trim() || "Profile image",
    [displayName],
  );

  useEffect(() => {
    if (!pendingImage) return;
    setCrop(getProfileCropBox({
      naturalWidth: pendingImage.naturalWidth,
      naturalHeight: pendingImage.naturalHeight,
    }));
  }, [pendingImage]);

  const previewStyle = useMemo(() => {
    if (!crop) return null;
    return {
      width: `${crop.width}px`,
      height: `${crop.height}px`,
      left: `${crop.offsetX}px`,
      top: `${crop.offsetY}px`,
    };
  }, [crop]);

  async function openCropper(file: File | null) {
    if (!file) return;
    if (!canUpload) {
      toast.error("No site is available for profile image uploads.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Only image uploads are supported.");
      return;
    }
    if (file.size / 1024 / 1024 > 50) {
      toast.error("File size too big (max 50MB).");
      return;
    }

    try {
      const src = await readFileAsDataUrl(file);
      const metadata = await loadImageMetadata(src);
      setPendingImage({
        src,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        fileName: file.name,
        mimeType: file.type,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load image.");
    }
  }

  function closeCropper() {
    setPendingImage(null);
    setCrop(null);
    dragRef.current = null;
  }

  async function commitCrop() {
    if (!pendingImage || !crop) return;
    if (!canUpload) {
      toast.error("No site is available for profile image uploads.");
      return;
    }

    try {
      setIsUploading(true);
      const blob = await cropProfileImageToBlob({ image: pendingImage, crop });
      const file = new File([blob], pendingImage.fileName.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
      const uploaded = await uploadSmart({
        file,
        siteId: normalizedSiteId,
        name: "profile-image",
      });
      setValue(uploaded.url);
      closeCropper();
      toast.success("Profile image updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload profile image.");
    } finally {
      setIsUploading(false);
    }
  }

  function setZoom(nextZoom: number) {
    if (!pendingImage || !crop) return;
    const previousCenterX = PROFILE_IMAGE_CROP_VIEWPORT / 2 - crop.offsetX;
    const previousCenterY = PROFILE_IMAGE_CROP_VIEWPORT / 2 - crop.offsetY;
    const nextCrop = getProfileCropBox({
      naturalWidth: pendingImage.naturalWidth,
      naturalHeight: pendingImage.naturalHeight,
      zoom: nextZoom,
    });
    const scaledCenterX = previousCenterX * (nextCrop.width / crop.width);
    const scaledCenterY = previousCenterY * (nextCrop.height / crop.height);
    const clamped = clampProfileCropOffset({
      width: nextCrop.width,
      height: nextCrop.height,
      offsetX: PROFILE_IMAGE_CROP_VIEWPORT / 2 - scaledCenterX,
      offsetY: PROFILE_IMAGE_CROP_VIEWPORT / 2 - scaledCenterY,
    });
    setCrop({ ...nextCrop, ...clamped });
  }

  return (
    <>
      <div className="flex flex-col gap-4 rounded-xl border border-stone-200 p-4 dark:border-stone-700 md:flex-row md:items-center">
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-stone-300 bg-stone-50 dark:border-stone-600 dark:bg-stone-900"
          aria-label="Profile image preview"
          data-testid="profile-image-preview"
        >
          {value ? (
            <img src={value} alt={previewAlt} className="h-full w-full object-cover" data-testid="profile-image-preview-image" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500"
              data-testid="profile-image-empty-state"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-9 w-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 20a6 6 0 0 0-12 0" />
                <circle cx="12" cy="10" r="4" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-stone-900 dark:text-white">Profile image</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Upload and crop a square image. Themes read this through `core.profile.*`.
            </p>
          </div>
          <input
            type="hidden"
            name="profileImageUrl"
            value={value}
            readOnly
            aria-label="Profile image"
            data-testid="profile-image-input"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canUpload || isUploading}
              className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Upload image
            </button>
            <button
              type="button"
              onClick={() =>
                openMediaPicker({
                  siteId: normalizedSiteId,
                  title: "Select Profile Image",
                  mode: "pick",
                  allowUpload: true,
                  allowedMimePrefixes: ["image/"],
                  onSelect: (items) => {
                    const next = items[0];
                    if (!next?.url) return;
                    setValue(next.url);
                  },
                })
              }
              disabled={!canUpload || isUploading}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-600 dark:bg-black dark:text-white"
            >
              Media library
            </button>
            <button
              type="button"
              onClick={() => setValue("")}
              disabled={!value || isUploading}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-600 dark:bg-black dark:text-white"
            >
              Clear
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {canUpload
              ? "If no profile image is set, the system falls back to provider image or generated avatar in runtime views."
              : "No site is available for upload. You can still paste a URL manually when supported by profile APIs."}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void openCropper(event.target.files?.[0] || null);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      <Dialog open={Boolean(pendingImage && crop)} onOpenChange={(open) => (!open ? closeCropper() : undefined)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Crop profile image</DialogTitle>
            <DialogDescription>Center the image inside the circular frame, then upload the cropped result.</DialogDescription>
          </DialogHeader>
          {pendingImage && crop ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div
                  className="relative overflow-hidden rounded-3xl border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900"
                  style={{ width: PROFILE_IMAGE_CROP_VIEWPORT, height: PROFILE_IMAGE_CROP_VIEWPORT }}
                >
                  <img
                    src={pendingImage.src}
                    alt="Crop preview"
                    className="absolute select-none object-cover"
                    style={previewStyle || undefined}
                    draggable={false}
                    onPointerDown={(event) => {
                      if (!crop) return;
                      dragRef.current = {
                        pointerId: event.pointerId,
                        originX: event.clientX,
                        originY: event.clientY,
                        startX: crop.offsetX,
                        startY: crop.offsetY,
                      };
                      (event.currentTarget as HTMLImageElement).setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (!dragRef.current || !crop) return;
                      const deltaX = event.clientX - dragRef.current.originX;
                      const deltaY = event.clientY - dragRef.current.originY;
                      const clamped = clampProfileCropOffset({
                        width: crop.width,
                        height: crop.height,
                        offsetX: dragRef.current.startX + deltaX,
                        offsetY: dragRef.current.startY + deltaY,
                      });
                      setCrop((previous) => (previous ? { ...previous, ...clamped } : previous));
                    }}
                    onPointerUp={(event) => {
                      if (dragRef.current?.pointerId === event.pointerId) {
                        dragRef.current = null;
                      }
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-0 bg-black/35" />
                    <div
                      className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.2)]"
                      style={{
                        inset: 16,
                        borderRadius: "9999px",
                      }}
                    />
                  </div>
                </div>
              </div>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-stone-900 dark:text-white">Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={crop.zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="w-full"
                />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={closeCropper}
              disabled={isUploading}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-600 dark:bg-black dark:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void commitCrop()}
              disabled={!pendingImage || !crop || isUploading}
              className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? "Uploading..." : "Crop and upload"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {mediaPickerElement}
    </>
  );
}
