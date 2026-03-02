"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import MediaPickerField from "@/components/media/media-picker-field";
import type { ThemeSettingsField } from "@/lib/themes";

type Props = {
  siteId: string;
  themeId: string;
  themeName: string;
  fields: ThemeSettingsField[];
  config: Record<string, unknown>;
  action: (formData: FormData) => Promise<void>;
};

export default function SiteThemeSettingsModal({
  siteId,
  themeId,
  themeName,
  fields,
  config,
  action,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const valueFor = (key: string, defaultValue?: string) => {
    const configured = String(config[key] || "").trim();
    if (configured.length > 0) return configured;
    return String(defaultValue || "");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="mt-3 inline-flex rounded-md border border-black bg-white px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-stone-100"
      >
        Theme Settings
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[2147482900] flex items-start justify-center bg-black/50 px-4 py-6 sm:items-center">
              <div className="flex max-h-[min(90vh,48rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-black bg-white text-black shadow-2xl">
                <div className="border-b border-stone-300 px-5 py-3">
                  <h3 className="text-sm font-semibold text-black">{themeName} Settings</h3>
                  <p className="mt-1 text-xs text-stone-700">Theme-level overrides only.</p>
                  <p className="mt-1 text-[11px] text-stone-600">
                    Fresh installs use each field&apos;s theme default value until saved.
                  </p>
                </div>
                <form action={action} className="flex min-h-0 flex-1 flex-col bg-white text-black">
                  <input type="hidden" name="themeId" value={themeId} />
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                    {fields.map((field) =>
                      field.type === "media" ? (
                        <div key={field.key} className="block text-xs">
                          <MediaPickerField
                            siteId={siteId}
                            name={field.key}
                            label={field.label}
                            initialValue={valueFor(field.key, field.defaultValue)}
                            initialMediaId={String(config[`${field.key}_media_id`] || "").trim()}
                            initialLabel={String(config[`${field.key}_media_label`] || "").trim()}
                            initialUrl={valueFor(field.key, field.defaultValue)}
                            valueMode="url"
                            companionMediaIdName={`${field.key}__mediaId`}
                          />
                          {field.helpText ? <span className="mt-1 block text-[11px] text-stone-600">{field.helpText}</span> : null}
                        </div>
                      ) : (
                        <label key={field.key} className="block text-xs">
                          <span className="mb-1 block font-medium text-black">{field.label}</span>
                          {field.type === "checkbox" ? (
                            <input type="checkbox" name={field.key} defaultChecked={Boolean(config[field.key])} className="h-4 w-4" />
                          ) : field.type === "textarea" ? (
                            <textarea
                              name={field.key}
                              defaultValue={valueFor(field.key, field.defaultValue)}
                              placeholder={field.placeholder}
                              className="min-h-24 w-full rounded-md border border-stone-400 bg-white px-2 py-1.5 text-xs text-black"
                            />
                          ) : (
                            <input
                              type={field.type || "text"}
                              name={field.key}
                              defaultValue={valueFor(field.key, field.defaultValue)}
                              placeholder={field.placeholder}
                              className="w-full rounded-md border border-stone-400 bg-white px-2 py-1.5 text-xs text-black"
                            />
                          )}
                          {field.helpText ? <span className="mt-1 block text-[11px] text-stone-600">{field.helpText}</span> : null}
                        </label>
                      ),
                    )}
                  </div>
                  <div className="flex items-center gap-2 border-t border-stone-300 px-5 py-3">
                    <button className="rounded-md border border-black bg-black px-3 py-1.5 text-xs font-semibold text-white">Save Theme Settings</button>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="rounded-md border border-black bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-stone-100"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
