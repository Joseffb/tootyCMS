"use client";

import { useState } from "react";

type Props = {
  title: string;
  description?: string;
  triggerLabel: string;
  submitLabel?: string;
  triggerClassName?: string;
};

export default function ConfirmFormSubmitButton({
  title,
  description,
  triggerLabel,
  submitLabel = "Save",
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [targetForm, setTargetForm] = useState<HTMLFormElement | null>(null);

  return (
    <>
      <button
        type="button"
        className={triggerClassName || "rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"}
        onClick={(event) => {
          const form = event.currentTarget.closest("form");
          setTargetForm(form);
          setOpen(true);
        }}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-lg border border-stone-300 bg-white p-4 shadow-2xl dark:border-stone-700 dark:bg-stone-950">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
            {description ? <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{description}</p> : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  targetForm?.requestSubmit();
                }}
                className="rounded-md border border-stone-300 bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700 dark:border-stone-600 dark:bg-stone-100 dark:text-stone-900"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
