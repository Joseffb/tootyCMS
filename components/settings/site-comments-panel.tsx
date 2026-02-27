"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CommentItem = {
  id: string;
  contextId: string;
  body: string;
  status: string;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_OPTIONS = ["", "pending", "approved", "rejected", "spam", "deleted"] as const;

function toDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function dedupeComments(items: CommentItem[]) {
  const byId = new Map<string, CommentItem>();
  for (const item of items) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

export default function SiteCommentsPanel({ siteId }: { siteId: string }) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [busyCommentId, setBusyCommentId] = useState<string>("");
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ siteId, contextType: "entry", limit: "200", offset: "0" });
      if (status) params.set("status", status);
      const response = await fetch(`/api/comments?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to load comments."));
      }
      setItems(Array.isArray(data.items) ? dedupeComments(data.items as CommentItem[]) : []);
    } catch (loadError) {
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load comments.");
    } finally {
      setLoading(false);
    }
  }, [siteId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      const key = String(item.status || "").toLowerCase() || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [items]);
  const selectedComment = useMemo(
    () => items.find((item) => item.id === selectedCommentId) || null,
    [items, selectedCommentId],
  );

  async function moderate(commentId: string, nextStatus: "pending" | "approved" | "rejected") {
    if (busyCommentId) return;
    setBusyCommentId(commentId);
    setError("");
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "moderate",
          siteId,
          status: nextStatus,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to update comment."));
      }
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Failed to update comment.");
    } finally {
      setBusyCommentId("");
    }
  }

  async function remove(commentId: string) {
    if (busyCommentId) return;
    setBusyCommentId(commentId);
    setError("");
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(commentId)}?siteId=${encodeURIComponent(siteId)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to delete comment."));
      }
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Failed to delete comment.");
    } finally {
      setBusyCommentId("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Comments</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Site-level comment moderation and review.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
        >
          {STATUS_OPTIONS.map((value) => (
            <option key={value || "all"} value={value}>
              {value ? value : "All statuses"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-black bg-black px-3 py-1 text-sm text-white"
        >
          Refresh
        </button>
        <div className="ml-auto flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-300">
          <span>Total: {items.length}</span>
          {Object.entries(totals).map(([key, value]) => (
            <span key={key}>
              {key}: {value}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-700">
          <thead className="bg-stone-50 dark:bg-stone-900/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Comment</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Author</th>
              <th className="px-3 py-2 text-left font-medium">Context</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {!loading && items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-stone-500 dark:text-stone-300" colSpan={6}>
                  No comments found.
                </td>
              </tr>
            ) : null}
            {items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/40"
                onClick={() => setSelectedCommentId(item.id)}
              >
                <td className="px-3 py-2 text-stone-800 dark:text-stone-100">
                  <div className="max-w-xl whitespace-pre-wrap line-clamp-3">{item.body}</div>
                </td>
                <td className="px-3 py-2 capitalize text-stone-700 dark:text-stone-200">{item.status}</td>
                <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{item.authorId || "Unknown"}</td>
                <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{item.contextId}</td>
                <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{toDate(item.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={busyCommentId === item.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void moderate(item.id, "approved");
                      }}
                      className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-700 disabled:opacity-50 dark:border-emerald-500 dark:text-emerald-400"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyCommentId === item.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void moderate(item.id, "rejected");
                      }}
                      className="rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-700 disabled:opacity-50 dark:border-amber-500 dark:text-amber-300"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busyCommentId === item.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void moderate(item.id, "pending");
                      }}
                      className="rounded border border-stone-500 px-2 py-0.5 text-xs text-stone-700 disabled:opacity-50 dark:border-stone-400 dark:text-stone-200"
                    >
                      Pending
                    </button>
                    <button
                      type="button"
                      disabled={busyCommentId === item.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void remove(item.id);
                      }}
                      className="rounded border border-red-700 px-2 py-0.5 text-xs text-red-700 disabled:opacity-50 dark:border-red-500 dark:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedComment ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setSelectedCommentId(null)}
        >
          <div
            className="w-full max-w-3xl rounded-lg border border-stone-300 bg-white p-4 text-black shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4 border-b border-stone-200 pb-3">
              <div>
                <p className="text-xs text-stone-500">{selectedComment.id}</p>
                <h3 className="font-cal text-lg capitalize">{selectedComment.status} comment</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCommentId(null)}
                className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
              >
                Close
              </button>
            </div>
            <div className="grid gap-1 text-xs text-stone-700">
              <p>
                <span className="font-semibold">Author:</span> {selectedComment.authorId || "Anonymous"}
              </p>
              <p>
                <span className="font-semibold">Context:</span> {selectedComment.contextId}
              </p>
              <p>
                <span className="font-semibold">Status:</span> {selectedComment.status}
              </p>
              <p>
                <span className="font-semibold">Created:</span> {toDate(selectedComment.createdAt)}
              </p>
              <p>
                <span className="font-semibold">Updated:</span> {toDate(selectedComment.updatedAt)}
              </p>
            </div>
            <div className="mt-4 rounded-md border border-stone-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Comment Body</p>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-black">
                {selectedComment.body || ""}
              </pre>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-stone-200 pt-3">
              <button
                type="button"
                disabled={busyCommentId === selectedComment.id}
                onClick={() => void moderate(selectedComment.id, "approved")}
                className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyCommentId === selectedComment.id}
                onClick={() => void moderate(selectedComment.id, "rejected")}
                className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-700 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busyCommentId === selectedComment.id}
                onClick={() => void moderate(selectedComment.id, "pending")}
                className="rounded border border-stone-500 px-2 py-1 text-xs text-stone-700 disabled:opacity-50"
              >
                Pending
              </button>
              <button
                type="button"
                disabled={busyCommentId === selectedComment.id}
                onClick={() => void remove(selectedComment.id)}
                className="rounded border border-red-700 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
