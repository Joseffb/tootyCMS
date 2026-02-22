"use client";

import { useRef, useState } from "react";

type SiteOption = {
  id: string;
  name: string | null;
};

type Props = {
  sites: SiteOption[];
  action: (formData: FormData) => Promise<void>;
};

export default function CreateScheduledActionPanel({ sites, action }: Props) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function onToggle() {
    if (open) {
      formRef.current?.reset();
      setOpen(false);
      return;
    }
    setOpen(true);
  }

  return (
    <div className="mt-8 rounded-lg border border-stone-200 p-4 dark:border-stone-700">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black"
      >
        {open ? "Cancel" : "Add Scheduled Action"}
      </button>

      {open ? (
        <form ref={formRef} action={action} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-stone-600 dark:text-stone-300">
            Name
            <input
              name="name"
              required
              placeholder="Ping Main Sitemap"
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            />
          </label>
          <label className="text-xs text-stone-600 dark:text-stone-300">
            Action Key
            <input
              name="actionKey"
              required
              placeholder="core.ping_sitemap"
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            />
          </label>
          <label className="text-xs text-stone-600 dark:text-stone-300">
            Owner Type
            <select
              name="ownerType"
              defaultValue="core"
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            >
              <option value="core">core</option>
              <option value="plugin">plugin</option>
              <option value="theme">theme</option>
            </select>
          </label>
          <label className="text-xs text-stone-600 dark:text-stone-300">
            Owner Id
            <input
              name="ownerId"
              defaultValue="core"
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            />
          </label>
          <label className="text-xs text-stone-600 dark:text-stone-300">
            Site
            <select
              name="siteId"
              defaultValue=""
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            >
              <option value="">(global)</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name || site.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-stone-600 dark:text-stone-300">
            Every (minutes)
            <input
              type="number"
              min={1}
              name="runEveryMinutes"
              defaultValue={60}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            />
          </label>
          <label className="text-xs text-stone-600 dark:text-stone-300 md:col-span-2">
            Payload (JSON)
            <textarea
              name="payload"
              defaultValue="{}"
              className="mt-1 h-20 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300 md:col-span-2">
            <input type="checkbox" name="enabled" defaultChecked className="h-4 w-4" />
            Enabled
          </label>
          <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black md:col-span-2">
            Create Scheduled Action
          </button>
        </form>
      ) : null}
    </div>
  );
}
