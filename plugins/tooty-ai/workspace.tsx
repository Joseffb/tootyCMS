"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { AiAction, AiRunResult } from "@/lib/ai-contracts";

type ProviderSummary = {
  id: string;
  ownerType: "core" | "plugin";
  ownerId: string;
  actions: string[];
  health: {
    ok: boolean;
    error?: string;
  };
};

type Props = {
  initialTab?: "assist" | "providers";
  siteId?: string;
  canRunAssist: boolean;
  providers: ProviderSummary[];
};

const ASSIST_ACTIONS: Array<{ value: AiAction; label: string }> = [
  { value: "generate", label: "Generate" },
  { value: "rewrite", label: "Rewrite" },
  { value: "summarize", label: "Summarize" },
];

export default function TootyAiWorkspace({
  initialTab = "assist",
  siteId = "",
  canRunAssist,
  providers,
}: Props) {
  const [tab, setTab] = useState<"assist" | "providers">(initialTab);
  const [action, setAction] = useState<AiAction>("generate");
  const [providerId, setProviderId] = useState(providers[0]?.id || "");
  const [sourceText, setSourceText] = useState("");
  const [instructionText, setInstructionText] = useState("");
  const [contextText, setContextText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const requestPreview = useMemo(
    () =>
      JSON.stringify(
        {
          scope: siteId ? { kind: "site", siteId } : null,
          action,
          input: {
            sourceText,
            instructionText: instructionText || undefined,
            contextText: contextText || undefined,
          },
          context: {
            surface: "plugin_workspace",
            pluginId: "tooty-ai",
          },
          providerId: providerId || undefined,
        },
        null,
        2,
      ),
    [action, contextText, instructionText, providerId, siteId, sourceText],
  );

  const activeProvider = providers.find((provider) => provider.id === providerId) || null;
  const canSubmit = Boolean(siteId && canRunAssist && sourceText.trim() && providerId && !submitting);

  async function runAssist() {
    if (!canSubmit) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "site", siteId },
          action,
          input: {
            sourceText,
            instructionText: instructionText || undefined,
            contextText: contextText || undefined,
          },
          context: {
            surface: "plugin_workspace",
            pluginId: "tooty-ai",
          },
          providerId: providerId || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as AiRunResult | { error?: string } | null;
      if (!response.ok) {
        setResult(null);
        setRequestError(String(payload && "error" in payload ? payload.error || "AI request failed." : "AI request failed."));
        return;
      }
      setResult((payload as AiRunResult) || null);
    } catch (error) {
      setResult(null);
      setRequestError(error instanceof Error ? error.message : "AI request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(
            "rounded-md border px-3 py-2 text-xs font-semibold",
            tab === "assist" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black",
          )}
          onClick={() => setTab("assist")}
        >
          Assist
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md border px-3 py-2 text-xs font-semibold",
            tab === "providers" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black",
          )}
          onClick={() => setTab("providers")}
        >
          Providers
        </button>
      </div>

      {tab === "assist" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
            <div>
              <h2 className="font-cal text-xl font-bold text-stone-900">AI Assist</h2>
              <p className="mt-1 text-sm text-stone-600">
                Build a normalized request, send it through the core AI spine, and preview the suggestion before you apply anything elsewhere.
              </p>
            </div>

            {!siteId ? (
              <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
                Select a site to run site-scoped AI assistance.
              </div>
            ) : null}
            {siteId && !canRunAssist ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                Your current role cannot run AI actions for this site.
              </div>
            ) : null}

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Action</span>
              <select
                value={action}
                onChange={(event) => setAction(event.target.value as AiAction)}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              >
                {ASSIST_ACTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Provider</span>
              <select
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.id}
                  </option>
                ))}
              </select>
              {activeProvider ? (
                <p className="text-[11px] text-stone-500">
                  Source: {activeProvider.ownerType === "core" ? "core" : `${activeProvider.ownerType}:${activeProvider.ownerId}`}{" "}
                  · Health: {activeProvider.health.ok ? "ok" : activeProvider.health.error || "unavailable"}
                </p>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Instruction</span>
              <textarea
                rows={3}
                value={instructionText}
                onChange={(event) => setInstructionText(event.target.value)}
                placeholder="Tell the AI how to handle the text."
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Source Text</span>
              <textarea
                rows={8}
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                placeholder="Paste or draft the source text to generate, rewrite, or summarize."
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Context Text</span>
              <textarea
                rows={4}
                value={contextText}
                onChange={(event) => setContextText(event.target.value)}
                placeholder="Optional context that should inform the result."
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!canSubmit}
                onClick={runAssist}
                className="rounded-md border border-black bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Running..." : "Run Assist"}
              </button>
              {requestError ? <span className="text-sm text-rose-700">{requestError}</span> : null}
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Request Preview</div>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-950 p-4 text-xs text-stone-100">
                <code>{requestPreview}</code>
              </pre>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Suggestion Preview</div>
              {!result ? (
                <p className="mt-3 text-sm text-stone-500">Run a request to preview the governed AI response.</p>
              ) : result.ok === false ? (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  {result.error}
                </div>
              ) : result.decision === "reject" ? (
                <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p>The guard layer rejected this output.</p>
                  <p>Trace ID: {result.traceId}</p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm whitespace-pre-wrap text-stone-800">
                    {result.output?.text || ""}
                  </div>
                  <div className="text-xs text-stone-500">
                    Decision: {result.decision} · Provider: {result.providerId} · Trace ID: {result.traceId}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Provider</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
                <th className="px-4 py-3 font-semibold">Health</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className="border-t border-stone-200">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-stone-900">{provider.id}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-stone-600">
                    {provider.ownerType === "core" ? "core" : `${provider.ownerType}:${provider.ownerId}`}
                  </td>
                  <td className="px-4 py-3 align-top text-stone-600">{provider.actions.join(", ")}</td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                        provider.health.ok
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800",
                      )}
                    >
                      {provider.health.ok ? "OK" : provider.health.error || "Unavailable"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
