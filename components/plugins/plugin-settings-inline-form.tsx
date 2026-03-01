"use client";

import { useState, useTransition } from "react";

type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  helpText?: string;
};

type Props = {
  pluginId: string;
  siteId?: string;
  fields: Field[];
  values: Record<string, unknown>;
  saveAction: (formData: FormData) => Promise<void>;
};

function fieldValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export default function PluginSettingsInlineForm({
  pluginId,
  siteId,
  fields,
  values,
  saveAction,
}: Props) {
  const [status, setStatus] = useState("All changes saved.");
  const [isPending, startTransition] = useTransition();

  function commit(nextValues: Record<string, unknown>, label: string) {
    setStatus(`Saving ${label}...`);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("pluginId", pluginId);
      if (siteId) formData.set("siteId", siteId);
      for (const field of fields) {
        const value = nextValues[field.key];
        if (field.type === "checkbox") {
          if (value) formData.set(field.key, "on");
        } else {
          formData.set(field.key, fieldValue(value));
        }
      }
      try {
        await saveAction(formData);
        setStatus(`${label} saved.`);
      } catch {
        setStatus(`Failed to save ${label.toLowerCase()}.`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-300">
          {isPending ? "Saving..." : status}
        </div>
        <div className="space-y-3">
          {fields.map((field) => {
            const currentValue = values[field.key];
            if (field.type === "checkbox") {
              const checked = Boolean(currentValue);
              return (
                <div
                  key={field.key}
                  className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[200px_minmax(0,1fr)]"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{field.label}</div>
                    {field.helpText ? (
                      <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{field.helpText}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => commit({ ...values, [field.key]: !checked }, field.label)}
                    className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                      checked
                        ? "border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-700 dark:bg-lime-950/30 dark:text-lime-200"
                        : "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                    }`}
                  >
                    {field.label}
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${checked ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70 dark:bg-stone-600"}`}></span>
                  </button>
                </div>
              );
            }

            if (field.type === "select" && Array.isArray(field.options)) {
              return (
                <div
                  key={field.key}
                  className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[200px_minmax(0,1fr)]"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{field.label}</div>
                    {field.helpText ? (
                      <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{field.helpText}</div>
                    ) : null}
                  </div>
                  <select
                    defaultValue={fieldValue(currentValue)}
                    onChange={(event) => commit({ ...values, [field.key]: event.target.value }, field.label)}
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-black"
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            return (
              <div
                key={field.key}
                className="grid gap-2 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 md:grid-cols-[200px_minmax(0,1fr)]"
              >
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{field.label}</div>
                  {field.helpText ? (
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{field.helpText}</div>
                  ) : null}
                </div>
                <input
                  defaultValue={fieldValue(currentValue)}
                  placeholder={field.placeholder}
                  onBlur={(event) => {
                    if (event.target.value === fieldValue(currentValue)) return;
                    commit({ ...values, [field.key]: event.target.value }, field.label);
                  }}
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-black"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
