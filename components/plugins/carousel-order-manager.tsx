"use client";

import { useMemo, useState, useTransition } from "react";

type SlideItem = {
  id: string;
  title: string;
  sortOrder: number;
  status?: string;
};

export default function CarouselOrderManager({
  siteId,
  slides,
  saveOrderAction,
}: {
  siteId: string;
  slides: SlideItem[];
  saveOrderAction: (formData: FormData) => Promise<void>;
}) {
  const [items, setItems] = useState(slides);
  const [draggingId, setDraggingId] = useState("");
  const [isPending, startTransition] = useTransition();

  const serializedOrder = useMemo(
    () => JSON.stringify(items.map((item, index) => ({ id: item.id, sortOrder: index }))),
    [items],
  );

  function moveItem(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setItems((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-cal text-xl dark:text-white">Slide Order</h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Drag slides into the display order you want, then save.
          </p>
        </div>
        <button
          type="button"
          disabled={isPending || items.length < 2}
          onClick={() =>
            startTransition(async () => {
              const formData = new FormData();
              formData.set("siteId", siteId);
              formData.set("order", serializedOrder);
              await saveOrderAction(formData);
            })
          }
          className={`rounded-md px-3 py-2 text-xs font-semibold ${
            isPending || items.length < 2
              ? "cursor-not-allowed border border-stone-300 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500"
              : "border border-black bg-black text-white"
          }`}
        >
          {isPending ? "Saving..." : "Save Order"}
        </button>
      </div>

      <div className="mt-4 grid gap-2">
        {items.map((item, index) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => setDraggingId(item.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              moveItem(draggingId, item.id);
              setDraggingId("");
            }}
            onDragEnd={() => setDraggingId("")}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
              draggingId === item.id
                ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20"
                : "border-stone-200 dark:border-stone-700"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="cursor-grab select-none text-lg leading-none text-stone-400">::</span>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-stone-100 px-2 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {index + 1}
              </span>
              <div>
                <div className="text-sm font-medium text-stone-900 dark:text-white">{item.title || "Untitled"}</div>
                {item.status ? (
                  <div className="text-xs text-stone-500 dark:text-stone-400">{item.status}</div>
                ) : null}
              </div>
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400">Current: {item.sortOrder}</div>
          </div>
        ))}
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 px-3 py-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            No slides available to reorder.
          </div>
        ) : null}
      </div>
    </div>
  );
}
