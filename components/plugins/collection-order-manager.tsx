"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

type SlideItem = {
  id: string;
  title: string;
  sortOrder: number;
  status?: string;
  editHref?: string;
};

export default function CollectionOrderManager({
  siteId,
  items: initialItems,
  saveOrderAction,
  extraFormData,
  title = "Items",
}: {
  siteId: string;
  items: SlideItem[];
  saveOrderAction: (formData: FormData) => Promise<void>;
  extraFormData?: Record<string, string>;
  title?: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [draggingId, setDraggingId] = useState("");
  const [isPending, startTransition] = useTransition();

  function buildNextOrder(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return null;
    const sourceIndex = items.findIndex((item) => item.id === sourceId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
    const next = [...items];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    return next;
  }

  function persistOrder(nextItems: SlideItem[]) {
    setItems(nextItems);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(
        "order",
        JSON.stringify(nextItems.map((item, index) => ({ id: item.id, sortOrder: index }))),
      );
      formData.set("siteId", siteId);
      for (const [key, value] of Object.entries(extraFormData || {})) {
        formData.set(key, value);
      }
      await saveOrderAction(formData);
    });
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-cal text-xl dark:text-white">{title}</h2>
        </div>
        <div className="text-xs text-stone-500 dark:text-stone-400">
          {items.length < 2 ? "Add more items to reorder." : isPending ? "Saving order..." : "Drag to reorder. Saves automatically."}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {items.map((item, index) => (
          <div
            key={item.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const nextItems = buildNextOrder(draggingId, item.id);
              if (nextItems) persistOrder(nextItems);
              setDraggingId("");
            }}
            onDragEnd={() => setDraggingId("")}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
              draggingId === item.id
                ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20"
                : "border-stone-200 dark:border-stone-700"
            }`}
          >
            <span
              draggable
              onDragStart={() => setDraggingId(item.id)}
              onDragEnd={() => setDraggingId("")}
              className="cursor-grab select-none text-lg leading-none text-stone-400"
              title="Drag to reorder"
              aria-label={`Drag ${item.title || "item"} to reorder`}
            >
              ::
            </span>
            {item.editHref ? (
              <Link
                href={item.editHref}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-1 py-1"
                draggable={false}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-stone-100 px-2 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900 dark:text-white">{item.title || "Untitled"}</div>
                    {item.status ? (
                      <div className="text-xs text-stone-500 dark:text-stone-400">{item.status}</div>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-stone-500 dark:text-stone-400">Current: {item.sortOrder}</div>
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-1 py-1">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-stone-100 px-2 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900 dark:text-white">{item.title || "Untitled"}</div>
                    {item.status ? (
                      <div className="text-xs text-stone-500 dark:text-stone-400">{item.status}</div>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-stone-500 dark:text-stone-400">Current: {item.sortOrder}</div>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 px-3 py-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            No items available to reorder.
          </div>
        ) : null}
      </div>
    </div>
  );
}
