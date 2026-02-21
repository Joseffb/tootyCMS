"use client";

import { useRef } from "react";
import type { ThemeSettingsField } from "@/lib/themes";

type Props = {
  themeId: string;
  themeName: string;
  fields: ThemeSettingsField[];
  config: Record<string, unknown>;
  action: (formData: FormData) => Promise<void>;
};

export default function SiteThemeSettingsModal({
  themeId,
  themeName,
  fields,
  config,
  action,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const valueFor = (key: string, defaultValue?: string) => {
    const configured = String(config[key] || "").trim();
    if (configured.length > 0) return configured;
    return String(defaultValue || "");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="mt-3 inline-flex rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-900"
      >
        Theme Settings
      </button>

      <dialog ref={dialogRef} className="w-full max-w-xl rounded-xl border border-stone-300 p-0 backdrop:bg-black/50 dark:border-stone-700">
        <div className="border-b border-stone-200 px-4 py-3 dark:border-stone-700">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-white">{themeName} Settings</h3>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">Theme-level overrides only.</p>
          <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
            Fresh installs use each field&apos;s theme default value until saved.
          </p>
        </div>
        <form action={action} className="space-y-3 px-4 py-4">
          <input type="hidden" name="themeId" value={themeId} />
          {fields.map((field) => (
            <label key={field.key} className="block text-xs">
              <span className="mb-1 block font-medium text-stone-800 dark:text-stone-200">{field.label}</span>
              {field.type === "checkbox" ? (
                <input type="checkbox" name={field.key} defaultChecked={Boolean(config[field.key])} className="h-4 w-4" />
              ) : field.type === "textarea" ? (
                <textarea
                  name={field.key}
                  defaultValue={valueFor(field.key, field.defaultValue)}
                  placeholder={field.placeholder}
                  className="min-h-24 w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs dark:border-stone-600 dark:bg-black dark:text-white"
                />
              ) : (
                <input
                  type={field.type || "text"}
                  name={field.key}
                  defaultValue={valueFor(field.key, field.defaultValue)}
                  placeholder={field.placeholder}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs dark:border-stone-600 dark:bg-black dark:text-white"
                />
              )}
              {field.helpText ? <span className="mt-1 block text-[11px] text-stone-500 dark:text-stone-400">{field.helpText}</span> : null}
            </label>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button className="rounded-md border border-black bg-black px-3 py-1.5 text-xs text-white">Save Theme Settings</button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 dark:border-stone-600 dark:text-stone-200"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
