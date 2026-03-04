"use client";

import { type ReactNode, useState } from "react";

type Props = {
  title: string;
  description?: string;
  triggerLabel?: string;
  confirmWord?: string;
  submitLabel?: string;
  action: (formData: FormData) => void | Promise<void>;
  children?: ReactNode;
  triggerClassName?: string;
};

export default function TypedDeleteModalSubmit({
  title,
  description,
  triggerLabel = "Delete",
  confirmWord = "delete",
  submitLabel = "Delete",
  action,
  children,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const typed = confirmText.trim().toLowerCase() === confirmWord.trim().toLowerCase();

  return (
    <>
      <button
        type="button"
        className={triggerClassName || "rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"}
        onClick={() => {
          setConfirmText("");
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
            <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
              Type <span className="font-semibold text-rose-700 dark:text-rose-300">{confirmWord}</span> to confirm.
            </p>

            <form action={action} className="mt-3 space-y-3">
              {children}
              <input
                name="confirm_text"
                type="text"
                autoFocus
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                placeholder={confirmWord}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!typed}
                  className="rounded-md border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-rose-700"
                >
                  {submitLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
