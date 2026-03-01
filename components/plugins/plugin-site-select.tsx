"use client";

type SiteOption = {
  id: string;
  label: string;
};

type Props = {
  currentValue: string;
  actionPath: string;
  hiddenParams?: Record<string, string>;
  options: SiteOption[];
};

export default function PluginSiteSelect({
  currentValue,
  actionPath,
  hiddenParams,
  options,
}: Props) {
  return (
    <form action={actionPath} className="flex flex-wrap items-end gap-3">
      {Object.entries(hiddenParams || {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Site</span>
        <select
          name="siteId"
          defaultValue={currentValue}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="w-80 rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-black"
        >
          <option value="">Select a site</option>
          {options.map((site) => (
            <option key={site.id} value={site.id}>
              {site.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
