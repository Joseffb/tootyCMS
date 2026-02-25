"use client";

import { useState } from "react";

type SiteOption = {
  id: string;
  name: string | null;
};

type Entry = {
  id: string;
  name: string;
  siteId: string | null;
  ownerType: string;
  ownerId: string;
  actionKey: string;
  runEveryMinutes: number;
  maxRetries: number;
  backoffBaseSeconds: number;
  retryCount: number;
  deadLettered: boolean;
  deadLetteredAt: string | Date | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRunAt: string | Date | null;
  enabled: boolean;
  payload: Record<string, unknown>;
  runAudits?: Array<{
    id: string;
    trigger: "cron" | "manual";
    status: string;
    error: string | null;
    durationMs: number;
    retryAttempt: number;
    createdAt: string | Date;
  }>;
  site?: { name?: string | null; subdomain?: string | null } | null;
};

type Props = {
  entry: Entry;
  sites: SiteOption[];
  actionOptions: Array<{ key: string; label: string; description?: string }>;
  onUpdate: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  onRunNow: (formData: FormData) => Promise<void>;
};

export default function ScheduledActionRow({ entry, sites, actionOptions, onUpdate, onDelete, onRunNow }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <tr className="border-t border-stone-200 dark:border-stone-800">
      <td className="px-3 py-3 align-top text-xs">{entry.name}</td>
      <td className="px-3 py-3 align-top text-xs">{entry.site?.name || entry.site?.subdomain || "Global"}</td>
      <td className="px-3 py-3 align-top text-xs">
        {entry.ownerType}:{entry.ownerId}
      </td>
      <td className="px-3 py-3 align-top text-xs font-mono">{entry.actionKey}</td>
      <td className="px-3 py-3 align-top text-xs">{entry.runEveryMinutes}m</td>
      <td className="px-3 py-3 align-top text-xs">
        <div>{entry.lastStatus || "pending"}</div>
        {entry.deadLettered ? <div className="mt-1 font-medium text-amber-600">dead-lettered</div> : null}
        {entry.lastError ? <div className="mt-1 text-red-600">{entry.lastError}</div> : null}
      </td>
      <td className="px-3 py-3 align-top text-xs">
        {entry.nextRunAt ? new Date(entry.nextRunAt).toLocaleString() : "paused"}
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-wrap gap-2">
          <form action={onRunNow}>
            <input type="hidden" name="id" value={entry.id} />
            <button className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">
              Run now
            </button>
          </form>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
          >
            Edit
          </button>
          <form action={onDelete}>
            <input type="hidden" name="id" value={entry.id} />
            <button className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 dark:border-red-700 dark:text-red-300">
              Delete
            </button>
          </form>
        </div>

        {editing ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-lg border border-stone-300 bg-white p-5 dark:border-stone-700 dark:bg-black">
              <h3 className="font-cal text-lg dark:text-white">Edit Scheduled Action</h3>
              <form action={onUpdate} className="mt-4 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="id" value={entry.id} />
                <label className="text-xs text-stone-600 dark:text-stone-300">
                  Name
                  <input
                    name="name"
                    defaultValue={entry.name}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-stone-600 dark:text-stone-300">
                  Site
                  <select
                    name="siteId"
                    defaultValue={entry.siteId || ""}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
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
                  Action Key
                  <input
                    name="actionKey"
                    defaultValue={entry.actionKey}
                    list={`schedule-action-options-${entry.id}`}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                  />
                  <datalist id={`schedule-action-options-${entry.id}`}>
                    {actionOptions.map((option) => (
                      <option key={`${entry.id}-${option.key}`} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="text-xs text-stone-600 dark:text-stone-300">
                  Every (minutes)
                  <input
                    type="number"
                    min={1}
                    name="runEveryMinutes"
                    defaultValue={entry.runEveryMinutes}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-stone-600 dark:text-stone-300">
                  Max Retries
                  <input
                    type="number"
                    min={0}
                    name="maxRetries"
                    defaultValue={entry.maxRetries}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-stone-600 dark:text-stone-300">
                  Backoff Base (seconds)
                  <input
                    type="number"
                    min={5}
                    name="backoffBaseSeconds"
                    defaultValue={entry.backoffBaseSeconds}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-stone-600 dark:text-stone-300 md:col-span-2">
                  Payload
                  <textarea
                    name="payload"
                    defaultValue={JSON.stringify(entry.payload || {}, null, 0)}
                    className="mt-1 h-20 w-full rounded border border-stone-300 px-2 py-1 font-mono text-[11px] dark:border-stone-600 dark:bg-stone-900 dark:text-white"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300 md:col-span-2">
                  <input type="checkbox" name="enabled" defaultChecked={entry.enabled} className="h-4 w-4" />
                  Enabled
                </label>
                <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 md:col-span-2">
                  <div>Retry Count: {entry.retryCount}</div>
                  <div>Dead Lettered: {entry.deadLettered ? "yes" : "no"}</div>
                  {entry.deadLetteredAt ? <div>Dead Lettered At: {new Date(entry.deadLetteredAt).toLocaleString()}</div> : null}
                </div>
                <div className="rounded-md border border-stone-200 p-2 md:col-span-2 dark:border-stone-700">
                  <div className="text-xs font-medium text-stone-700 dark:text-stone-200">Recent Runs</div>
                  <div className="mt-2 max-h-32 overflow-auto">
                    {entry.runAudits && entry.runAudits.length > 0 ? (
                      <table className="min-w-full text-[11px]">
                        <thead>
                          <tr className="text-stone-500 dark:text-stone-400">
                            <th className="px-1 py-1 text-left">When</th>
                            <th className="px-1 py-1 text-left">Trigger</th>
                            <th className="px-1 py-1 text-left">Status</th>
                            <th className="px-1 py-1 text-left">Attempt</th>
                            <th className="px-1 py-1 text-left">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.runAudits.map((run) => (
                            <tr key={run.id} className="border-t border-stone-200 dark:border-stone-700">
                              <td className="px-1 py-1">{new Date(run.createdAt).toLocaleString()}</td>
                              <td className="px-1 py-1">{run.trigger}</td>
                              <td className="px-1 py-1">
                                {run.status}
                                {run.error ? <span className="ml-1 text-red-600">({run.error})</span> : null}
                              </td>
                              <td className="px-1 py-1">{run.retryAttempt}</td>
                              <td className="px-1 py-1">{run.durationMs}ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-stone-500 dark:text-stone-400">No run history yet.</div>
                    )}
                  </div>
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <button
                    className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                    onClick={() => setEditing(false)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
