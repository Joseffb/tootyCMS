"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export type MediaSelection = {
  mediaId: string;
  url?: string;
  mimeType: string;
  width?: number;
  height?: number;
  label?: string;
  altText?: string;
  caption?: string;
};

type MediaItem = {
  id: number;
  url: string;
  objectKey: string;
  label: string | null;
  altText: string | null;
  caption: string | null;
  description: string | null;
  mimeType: string | null;
  size: number | null;
  provider: string;
  userId: string | null;
  createdAt: string | null;
};

type FilterKey = "all" | "image" | "video" | "document";
type ViewMode = "grid" | "list";

type Props = {
  open: boolean;
  onClose: () => void;
  siteId: string;
  mode?: "pick" | "manage";
  title?: string;
  selectedIds?: string[];
  multiSelect?: boolean;
  allowedMimePrefixes?: string[];
  allowUpload?: boolean;
  onSelect?: (items: MediaSelection[]) => void;
};

function inferFilterKey(item: MediaItem): FilterKey {
  const mimeType = String(item.mimeType || "").toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

function itemMatchesAllowedPrefixes(item: MediaItem, allowedMimePrefixes: string[]) {
  if (!Array.isArray(allowedMimePrefixes) || allowedMimePrefixes.length === 0) return true;
  const mimeType = String(item.mimeType || "").toLowerCase();
  return allowedMimePrefixes.some((prefix) => mimeType.startsWith(String(prefix || "").toLowerCase()));
}

function itemMatchesSearch(item: MediaItem, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return [item.label || "", item.altText || "", item.caption || "", item.description || "", item.objectKey || "", item.url || ""]
    .some((value) => String(value || "").toLowerCase().includes(normalized));
}

function itemMatchesFilter(item: MediaItem, filter: FilterKey) {
  return filter === "all" ? true : inferFilterKey(item) === filter;
}

function formatItemLabel(item: MediaItem) {
  return item.label || item.objectKey.split("/").pop() || item.objectKey;
}

function normalizeSelection(item: MediaItem): MediaSelection {
  return {
    mediaId: String(item.id),
    url: item.url,
    mimeType: String(item.mimeType || "application/octet-stream"),
    label: formatItemLabel(item),
    altText: item.altText || undefined,
    caption: item.caption || undefined,
  };
}

function formatFileSize(value: number | null) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "Unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(item: MediaItem | null) {
  return String(item?.mimeType || "").toLowerCase().startsWith("image/");
}

function getPreviewAlt(item: MediaItem) {
  return String(item.altText || "").trim() || formatItemLabel(item);
}

function MediaDetailsPane({
  focusedItem,
  editorLabel,
  editorAltText,
  editorCaption,
  editorDescription,
  onEditorLabelChange,
  onEditorAltTextChange,
  onEditorCaptionChange,
  onEditorDescriptionChange,
  onSave,
  isSavingDetails,
  deleteArmedForId,
  deleteConfirm,
  onDeleteConfirmChange,
  onArmDelete,
  onDelete,
  onCancelDelete,
  isDeleting,
}: {
  focusedItem: MediaItem | null;
  editorLabel: string;
  editorAltText: string;
  editorCaption: string;
  editorDescription: string;
  onEditorLabelChange: (value: string) => void;
  onEditorAltTextChange: (value: string) => void;
  onEditorCaptionChange: (value: string) => void;
  onEditorDescriptionChange: (value: string) => void;
  onSave: () => void;
  isSavingDetails: boolean;
  deleteArmedForId: string;
  deleteConfirm: string;
  onDeleteConfirmChange: (value: string) => void;
  onArmDelete: (itemId: string) => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  isDeleting: boolean;
}) {
  if (!focusedItem) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-stone-500">
        Select a media item to preview and edit it.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          {isImage(focusedItem) ? (
            <img src={focusedItem.url} alt={getPreviewAlt(focusedItem)} className="aspect-[4/3] h-auto w-full object-cover" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
              {inferFilterKey(focusedItem)}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            File Name
            <input
              value={editorLabel}
              onChange={(event) => onEditorLabelChange(event.target.value)}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            Alt Text
            <textarea
              value={editorAltText}
              onChange={(event) => onEditorAltTextChange(event.target.value)}
              rows={3}
              placeholder="Describe the image for accessibility"
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            Caption
            <textarea
              value={editorCaption}
              onChange={(event) => onEditorCaptionChange(event.target.value)}
              rows={3}
              placeholder="Optional display caption"
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            Description
            <textarea
              value={editorDescription}
              onChange={(event) => onEditorDescriptionChange(event.target.value)}
              rows={4}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
            />
          </label>
          <div className="grid gap-1 text-xs text-stone-600">
            <div>Provider: {focusedItem.provider}</div>
            <div>Type: {focusedItem.mimeType || "application/octet-stream"}</div>
            <div>Size: {formatFileSize(focusedItem.size)}</div>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={isSavingDetails}
            className="w-full rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingDetails ? "Saving..." : "Save Details"}
          </button>
        </div>
        <div className="rounded-xl border border-rose-300 bg-rose-50">
          {deleteArmedForId === String(focusedItem.id) ? (
            <div className="space-y-3 p-4">
              <div className="text-sm font-semibold text-rose-800">Delete this media item?</div>
              <label className="grid gap-1 text-xs text-rose-800">
                <span>Type delete to confirm</span>
                <input
                  value={deleteConfirm}
                  onChange={(event) => onDeleteConfirmChange(event.target.value)}
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm text-black"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="rounded-md border border-rose-600 bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onArmDelete(String(focusedItem.id))}
              className="block w-full px-4 py-4 text-left text-sm font-semibold text-rose-800"
            >
              Delete Media
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MediaManagerModal({
  open,
  onClose,
  siteId,
  mode = "pick",
  title = "Media Manager",
  selectedIds = [],
  multiSelect = false,
  allowedMimePrefixes = [],
  allowUpload = true,
  onSelect,
}: Props) {
  const topLayerClass = "z-[2147483000]";
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [focusedId, setFocusedId] = useState<string>(selectedIds[0] || "");
  const [status, setStatus] = useState("");
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [editorLabel, setEditorLabel] = useState("");
  const [editorAltText, setEditorAltText] = useState("");
  const [editorCaption, setEditorCaption] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [deleteArmedForId, setDeleteArmedForId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          itemMatchesAllowedPrefixes(item, allowedMimePrefixes) &&
          itemMatchesFilter(item, filter) &&
          itemMatchesSearch(item, search),
      ),
    [allowedMimePrefixes, filter, items, search],
  );

  const focusedItem =
    visibleItems.find((item) => String(item.id) === focusedId) ||
    items.find((item) => String(item.id) === focusedId) ||
    null;

  useEffect(() => {
    if (!open) return;
    setSelected(selectedIds);
    setFocusedId(selectedIds[0] || "");
  }, [open, selectedIds]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!focusedItem) {
      setEditorLabel("");
      setEditorAltText("");
      setEditorCaption("");
      setEditorDescription("");
      setDeleteArmedForId("");
      setDeleteConfirm("");
      return;
    }
    setEditorLabel(focusedItem.label || "");
    setEditorAltText(focusedItem.altText || "");
    setEditorCaption(focusedItem.caption || "");
    setEditorDescription(focusedItem.description || "");
    if (deleteArmedForId && deleteArmedForId !== String(focusedItem.id)) {
      setDeleteArmedForId("");
      setDeleteConfirm("");
    }
  }, [focusedItem, deleteArmedForId]);

  useEffect(() => {
    if (!visibleItems.length) return;
    if (focusedId && visibleItems.some((item) => String(item.id) === focusedId)) return;
    const nextFocused = selected.find((id) => visibleItems.some((item) => String(item.id) === id)) || String(visibleItems[0].id);
    setFocusedId(nextFocused);
  }, [focusedId, selected, visibleItems]);

  async function loadItems(nextFocusedId?: string) {
    if (!siteId) return;
    setIsLoading(true);
    setStatus("");
    try {
      const response = await fetch(`/api/media?siteId=${encodeURIComponent(siteId)}&limit=100`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({ items: [] }));
      if (!response.ok) {
        const message = String(json?.error || "Failed to load media.");
        setStatus(message);
        toast.error(message);
        setItems([]);
        return;
      }
      const nextItems = Array.isArray(json?.items) ? json.items : [];
      setItems(nextItems);
      if (nextFocusedId) {
        setFocusedId(nextFocusedId);
      } else if (nextItems.length === 0) {
        setFocusedId("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load media.";
      setStatus(message);
      toast.error(message);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId]);

  async function handleUpload(file: File | null) {
    if (!file || !siteId) return;
    setIsUploading(true);
    setStatus("Uploading...");
    try {
      const formData = new FormData();
      formData.append("siteId", siteId);
      formData.append("name", file.name);
      formData.append("file", file);

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(json?.error || "Upload failed.");
        setStatus(message);
        toast.error(message);
        return;
      }
      const nextId = String(json?.mediaId || "").trim();
      setStatus("Upload complete.");
      toast.success("Media uploaded.");
      await loadItems(nextId);
      if (nextId) {
        setSelected((current) => (multiSelect ? Array.from(new Set([...current, nextId])) : [nextId]));
        setFocusedId(nextId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setStatus(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function focusItem(itemId: string) {
    setFocusedId(itemId);
  }

  function toggleSelect(itemId: string) {
    setFocusedId(itemId);
    setContextMenu(null);
    setSelected((current) => {
      if (!multiSelect) return current[0] === itemId ? [] : [itemId];
      if (current.includes(itemId)) return current.filter((id) => id !== itemId);
      return [...current, itemId];
    });
  }

  async function saveDetails() {
    if (!focusedItem || !siteId) return;
    setIsSavingDetails(true);
    setStatus("Saving details...");
    try {
      const response = await fetch(`/api/media/${focusedItem.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          siteId,
          label: editorLabel,
          altText: editorAltText,
          caption: editorCaption,
          description: editorDescription,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(json?.error || "Failed to save details.");
        setStatus(message);
        toast.error(message);
        return;
      }
      const nextItem = json?.item as MediaItem | null;
      if (nextItem) {
        setItems((current) =>
          current.map((item) => (item.id === nextItem.id ? { ...item, ...nextItem } : item)),
        );
      } else {
        await loadItems(String(focusedItem.id));
      }
      setStatus("Details saved.");
      toast.success("Media details updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save details.";
      setStatus(message);
      toast.error(message);
    } finally {
      setIsSavingDetails(false);
    }
  }

  function armDelete(itemId: string) {
    setFocusedId(itemId);
    setDeleteArmedForId(itemId);
    setDeleteConfirm("");
    setContextMenu(null);
  }

  function openEditor(itemId: string) {
    setFocusedId(itemId);
    setViewMode("list");
    setContextMenu(null);
  }

  async function deleteFocused() {
    if (!focusedItem || !siteId) return;
    setIsDeleting(true);
    setStatus("Deleting media...");
    try {
      const response = await fetch(`/api/media/${focusedItem.id}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          siteId,
          confirm: deleteConfirm,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(json?.error || "Failed to delete media.");
        setStatus(message);
        toast.error(message);
        return;
      }
      const deletedId = String(focusedItem.id);
      setItems((current) => current.filter((item) => String(item.id) !== deletedId));
      setSelected((current) => current.filter((id) => id !== deletedId));
      setDeleteArmedForId("");
      setDeleteConfirm("");
      setFocusedId("");
      setStatus("Media deleted.");
      toast.success("Media deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete media.";
      setStatus(message);
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  }

  function confirmSelection() {
    if (!onSelect) {
      onClose();
      return;
    }
    const nextSelection = selected
      .map((mediaId) => items.find((item) => String(item.id) === mediaId))
      .filter((item): item is MediaItem => Boolean(item))
      .map(normalizeSelection);
    onSelect(nextSelection);
    onClose();
  }

  if (!open) return null;

  return (
    <div className={`fixed inset-0 ${topLayerClass} flex items-center justify-center bg-black/65 p-4`}>
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-black">{title}</h3>
            <p className="mt-1 text-xs text-stone-600">
              {mode === "manage"
                ? "Manage site-scoped media from the governed media spine."
                : "Choose media from the governed site library."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
          >
            Close
          </button>
        </div>

        <div className="border-b border-stone-200 px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto_auto]">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search label, file name, URL, or description"
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
              Type
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as FilterKey)}
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
              >
                <option value="all">All Files</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="document">Documents</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
              View
              <select
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value as ViewMode)}
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-black"
              >
                <option value="grid">Grid</option>
                <option value="list">List</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadItems(focusedId)}
              className="self-end rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
            >
              Refresh
            </button>
            {allowUpload ? (
              <div className="self-end">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? "Uploading..." : "Upload"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void handleUpload(file);
                  }}
                />
              </div>
            ) : (
              <div />
            )}
          </div>
          {status ? <p className="mt-3 text-xs text-stone-600">{status}</p> : null}
        </div>

        {allowUpload ? (
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDropTarget(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDropTarget(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setIsDropTarget(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDropTarget(false);
              const file = event.dataTransfer.files?.[0] ?? null;
              void handleUpload(file);
            }}
            className={`mx-5 mt-4 rounded-xl border border-dashed px-4 py-3 text-sm ${
              isDropTarget
                ? "border-cyan-500 bg-cyan-50 text-cyan-900"
                : "border-stone-300 bg-stone-50 text-stone-600"
            }`}
          >
            Drag and drop a file here to upload it to the media library.
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-stone-600">Loading media...</p>
          ) : visibleItems.length === 0 ? (
            <p className="text-sm text-stone-600">No media files match the current filters.</p>
          ) : viewMode === "list" ? (
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                <div className="grid grid-cols-[72px_minmax(0,1.6fr)_minmax(0,1fr)_100px] gap-3 border-b border-stone-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                  <span>Preview</span>
                  <span>Name</span>
                  <span>Type</span>
                  <span>Size</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {visibleItems.map((item) => {
                    const itemId = String(item.id);
                    const selectedState = selected.includes(itemId);
                    const focusedState = focusedId === itemId;
                    return (
                      <button
                        key={`media-row-${item.id}`}
                        type="button"
                        onClick={() => toggleSelect(itemId)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ itemId, x: event.clientX, y: event.clientY });
                          focusItem(itemId);
                        }}
                        className={`grid w-full grid-cols-[72px_minmax(0,1.6fr)_minmax(0,1fr)_100px] gap-3 border-b border-stone-200 px-4 py-3 text-left ${
                          focusedState
                            ? "bg-cyan-50"
                            : selectedState
                              ? "bg-stone-100"
                              : "bg-white hover:bg-stone-50"
                        }`}
                      >
                        <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
                          {isImage(item) ? (
                            <img src={item.url} alt={getPreviewAlt(item)} className="aspect-square h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex aspect-square items-center justify-center px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                              {inferFilterKey(item)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-black">{formatItemLabel(item)}</div>
                          <div className="truncate text-xs text-stone-500">{item.objectKey}</div>
                        </div>
                        <div className="min-w-0 truncate text-xs text-stone-600">{item.mimeType || "application/octet-stream"}</div>
                        <div className="text-xs text-stone-600">{formatFileSize(item.size)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                <MediaDetailsPane
                  focusedItem={focusedItem}
                  editorLabel={editorLabel}
                  editorAltText={editorAltText}
                  editorCaption={editorCaption}
                  editorDescription={editorDescription}
                  onEditorLabelChange={setEditorLabel}
                  onEditorAltTextChange={setEditorAltText}
                  onEditorCaptionChange={setEditorCaption}
                  onEditorDescriptionChange={setEditorDescription}
                  onSave={() => void saveDetails()}
                  isSavingDetails={isSavingDetails}
                  deleteArmedForId={deleteArmedForId}
                  deleteConfirm={deleteConfirm}
                  onDeleteConfirmChange={setDeleteConfirm}
                  onArmDelete={armDelete}
                  onDelete={() => void deleteFocused()}
                  onCancelDelete={() => {
                    setDeleteArmedForId("");
                    setDeleteConfirm("");
                  }}
                  isDeleting={isDeleting}
                />
              </div>
            </div>
          ) : (
            <div className={`grid min-h-0 flex-1 gap-4 ${focusedItem ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
              <div className="min-h-0 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {visibleItems.map((item) => {
                    const itemId = String(item.id);
                    const isSelected = selected.includes(itemId);
                    const itemIsImage = isImage(item);
                    return (
                      <button
                        key={`media-card-${item.id}`}
                        type="button"
                        onClick={() => toggleSelect(itemId)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ itemId, x: event.clientX, y: event.clientY });
                          focusItem(itemId);
                        }}
                        aria-pressed={isSelected}
                        className={`overflow-hidden rounded-xl border text-left ${
                          isSelected
                            ? "border-cyan-500 bg-cyan-50"
                            : "border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-stone-100"
                        }`}
                      >
                        <div className="aspect-square overflow-hidden border-b border-stone-200 bg-white">
                          {itemIsImage ? (
                            <img
                              src={item.url}
                              alt={getPreviewAlt(item)}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center px-3 text-center text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
                              {inferFilterKey(item)}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 p-3">
                          <div className="truncate text-sm font-semibold text-black">{formatItemLabel(item)}</div>
                          <div className="truncate text-[11px] text-stone-500">{item.mimeType || "application/octet-stream"}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {focusedItem ? (
                <div className="min-h-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                  <MediaDetailsPane
                    focusedItem={focusedItem}
                    editorLabel={editorLabel}
                    editorAltText={editorAltText}
                    editorCaption={editorCaption}
                    editorDescription={editorDescription}
                    onEditorLabelChange={setEditorLabel}
                    onEditorAltTextChange={setEditorAltText}
                    onEditorCaptionChange={setEditorCaption}
                    onEditorDescriptionChange={setEditorDescription}
                    onSave={() => void saveDetails()}
                    isSavingDetails={isSavingDetails}
                    deleteArmedForId={deleteArmedForId}
                    deleteConfirm={deleteConfirm}
                    onDeleteConfirmChange={setDeleteConfirm}
                    onArmDelete={armDelete}
                    onDelete={() => void deleteFocused()}
                    onCancelDelete={() => {
                      setDeleteArmedForId("");
                      setDeleteConfirm("");
                    }}
                    isDeleting={isDeleting}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-stone-200 px-5 py-4">
          <p className="text-xs text-stone-600">
            {selected.length === 0
              ? "Nothing selected."
              : `${selected.length} item${selected.length === 1 ? "" : "s"} selected.`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
            >
              Cancel
            </button>
            {mode === "pick" ? (
              <button
                type="button"
                onClick={confirmSelection}
                disabled={selected.length === 0}
                className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {multiSelect ? "Insert Selected" : "Choose"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div
          className="fixed z-[13100] min-w-40 rounded-md border border-stone-300 bg-white p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              openEditor(contextMenu.itemId);
              setSelected((current) => (multiSelect ? Array.from(new Set([...current, contextMenu.itemId])) : [contextMenu.itemId]));
            }}
            className="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-black hover:bg-stone-100"
          >
            Edit details
          </button>
          <button
            type="button"
            onClick={() => armDelete(contextMenu.itemId)}
            className="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            Delete media...
          </button>
        </div>
      ) : null}
    </div>
  );
}
