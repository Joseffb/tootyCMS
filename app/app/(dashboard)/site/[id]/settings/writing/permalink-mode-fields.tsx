"use client";

import { useMemo, useState } from "react";

type DomainOption = {
  key: string;
  label: string;
};

type Props = {
  mode: "default" | "custom";
  singlePattern: string;
  listPattern: string;
  noDomainPrefix: string;
  noDomainDataDomain: string;
  domains: DomainOption[];
};

export default function PermalinkModeFields({
  mode,
  singlePattern,
  listPattern,
  noDomainPrefix,
  noDomainDataDomain,
  domains,
}: Props) {
  const [value, setValue] = useState<"default" | "custom">(mode);
  const domainOptions = useMemo(() => (domains.length ? domains : [{ key: "post", label: "Post" }]), [domains]);

  return (
    <>
      <label className="flex flex-col gap-2 text-sm dark:text-white">
        <span>Permalink Group</span>
        <select
          name="writing_permalink_mode"
          value={value}
          onChange={(event) => setValue(event.target.value === "custom" ? "custom" : "default")}
          className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
        >
          <option value="default">Default Data Domain SEO (Recommended)</option>
          <option value="custom">Custom Patterns</option>
        </select>
      </label>

      <div className="rounded-md border border-stone-200 p-3 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300">
        Default group:
        <br />
        Archive: <code>/%domain_plural%</code>
        <br />
        Detail: <code>/%domain%/%slug%</code>
      </div>

      {value === "custom" ? (
        <>
          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>Custom Single Pattern</span>
            <input
              name="writing_single_pattern"
              defaultValue={singlePattern}
              placeholder="/%domain%/%slug%"
              className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>Custom List Pattern</span>
            <input
              name="writing_list_pattern"
              defaultValue={listPattern}
              placeholder="/%domain_plural%"
              className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>No-Domain Prefix (optional)</span>
            <input
              name="writing_no_domain_prefix"
              defaultValue={noDomainPrefix}
              placeholder="content"
              className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            />
            <span className="text-xs text-stone-500 dark:text-stone-400">
              Example: prefix <code>content</code> makes routes like <code>/content</code> and <code>/content/my-slug</code>.
            </span>
          </label>

          <label className="flex flex-col gap-2 text-sm dark:text-white">
            <span>No-Domain Prefix Data Domain</span>
            <select
              name="writing_no_domain_data_domain"
              defaultValue={noDomainDataDomain}
              className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-black dark:text-white"
            >
              {domainOptions.map((domain) => (
                <option key={domain.key} value={domain.key}>
                  {domain.label} ({domain.key})
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </>
  );
}

