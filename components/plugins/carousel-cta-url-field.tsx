"use client";

import { useState } from "react";

type Props = {
  name: string;
  defaultValue?: string;
  siteSubdomain?: string;
  rows?: number;
  className?: string;
};

function toDomainLabelSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTitleDomainValue(title: string) {
  const slug = toDomainLabelSlug(title);
  if (!slug) return "{domain}";
  if (slug === "main" || slug === "root" || slug === "home" || slug === "homepage") {
    return "{domain}";
  }
  return `${slug}.{domain}`;
}

export default function CarouselCtaUrlField({
  name,
  defaultValue = "",
  siteSubdomain = "",
  rows = 3,
  className = "rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black",
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const normalizedSiteSubdomain = String(siteSubdomain || "").trim().toLowerCase();
  const currentSubdomainValue =
    normalizedSiteSubdomain && normalizedSiteSubdomain !== "main"
      ? `${normalizedSiteSubdomain}.{domain}`
      : "";

  function setFromTitle(form: HTMLFormElement | null) {
    const titleInput = form?.querySelector<HTMLInputElement>('input[name="title"]');
    setValue(buildTitleDomainValue(titleInput?.value || ""));
  }

  return (
    <>
      <p className="mb-2 text-xs text-stone-600">
        Tip: use <code>{"{domain}"}</code> for root and <code>label.{"{domain}"}</code> for subdomains.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setValue("{domain}")}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
        >
          Root
        </button>
        {currentSubdomainValue ? (
          <button
            type="button"
            onClick={() => setValue(currentSubdomainValue)}
            className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
          >
            Current Sub
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => setFromTitle(event.currentTarget.closest("form"))}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
        >
          Label.Root
        </button>
        <button
          type="button"
          onClick={() => setValue("https://")}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black"
        >
          External
        </button>
      </div>
      <textarea
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={className}
      />
    </>
  );
}
