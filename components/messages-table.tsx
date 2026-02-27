"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CommunicationListItem } from "@/lib/communications-types";

type Props = {
  items: CommunicationListItem[];
  siteId?: string;
};

type MessageAction = "retry" | "requeue" | "mark_dead";

const ACTION_LABELS: Record<MessageAction, string> = {
  retry: "Retry now",
  requeue: "Requeue",
  mark_dead: "Mark dead",
};

export default function MessagesTable({ items, siteId }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const selected = useMemo(() => items.find((row) => row.id === selectedId) || null, [items, selectedId]);

  const prettyMetadata = useMemo(() => {
    if (!selected) return "";
    try {
      return JSON.stringify(selected.metadata ?? {}, null, 2);
    } catch {
      return String(selected.metadata || "");
    }
  }, [selected]);

  async function runAction(messageId: string, action: MessageAction) {
    const token = `${messageId}:${action}`;
    setActiveAction(token);
    try {
      const response = await fetch(`/api/communications/messages/${messageId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          siteId: siteId || null,
        }),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: "Invalid response." }));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || `Action failed (${response.status}).`));
      }
      setMenu(null);
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to apply message action.");
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <>
      <div
        className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700"
        onClick={() => setMenu(null)}
      >
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 dark:bg-stone-900">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-stone-500" colSpan={8}>
                  No messages found.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900/40"
                  onClick={() => setSelectedId(row.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, rowId: row.id });
                  }}
                >
                  <td className="px-3 py-2 text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">{row.createdByEmail || row.createdByUserId || "system"}</td>
                  <td className="px-3 py-2 text-xs">{row.siteName || row.siteId || "Global"}</td>
                  <td className="px-3 py-2 text-xs">{row.to}</td>
                  <td className="px-3 py-2 text-xs">{row.subject || "—"}</td>
                  <td className="px-3 py-2 text-xs">{row.status}</td>
                  <td className="px-3 py-2 text-xs font-mono">{row.providerId || "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.attemptCount}/{row.maxAttempts}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setSelectedId(null)}>
          <div
            className="w-full max-w-3xl rounded-lg border border-stone-300 bg-white p-4 text-black shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4 border-b border-stone-200 pb-3">
              <div>
                <p className="text-xs text-stone-500">{selected.id}</p>
                <h3 className="font-cal text-lg">{selected.subject || "(no subject)"}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
              >
                Close
              </button>
            </div>
            <div className="grid gap-1 text-xs text-stone-700">
              <p>
                <span className="font-semibold">From:</span>{" "}
                {selected.createdByEmail || selected.createdByUserId || "system"}
              </p>
              <p>
                <span className="font-semibold">To:</span> {selected.to}
              </p>
              <p>
                <span className="font-semibold">Site:</span> {selected.siteName || selected.siteId || "Global"}
              </p>
              <p>
                <span className="font-semibold">Status:</span> {selected.status}
              </p>
              <p>
                <span className="font-semibold">Provider:</span> {selected.providerId || "—"}
              </p>
              <p>
                <span className="font-semibold">Created:</span> {new Date(selected.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="mt-4 rounded-md border border-stone-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Message Body</p>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-black">{selected.body || ""}</pre>
            </div>
            <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Metadata</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-black">{prettyMetadata}</pre>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-stone-200 pt-3">
              {(["retry", "requeue", "mark_dead"] as MessageAction[]).map((action) => {
                const token = `${selected.id}:${action}`;
                const busy = activeAction === token;
                return (
                  <button
                    key={action}
                    type="button"
                    onClick={() => runAction(selected.id, action)}
                    disabled={Boolean(activeAction)}
                    className="rounded border border-stone-300 px-2.5 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-60"
                  >
                    {busy ? "Working..." : ACTION_LABELS[action]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {menu ? (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-stone-300 bg-white p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {(["retry", "requeue", "mark_dead"] as MessageAction[]).map((action) => {
            const token = `${menu.rowId}:${action}`;
            const busy = activeAction === token;
            return (
              <button
                key={action}
                type="button"
                onClick={() => runAction(menu.rowId, action)}
                disabled={Boolean(activeAction)}
                className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-stone-100 disabled:opacity-60"
              >
                {busy ? "Working..." : ACTION_LABELS[action]}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
