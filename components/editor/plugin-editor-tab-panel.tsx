"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EditorMetaEntry } from "@/lib/editor-meta";
import type { PluginEditorTab, PluginEditorTabField, PluginEditorTabFragment } from "@/lib/extension-contracts";
import {
  readPluginEditorFieldValue,
  writePluginEditorFieldValue,
  type EditorPluginTabMediaValue,
} from "@/lib/editor-plugin-tabs";
import type { MediaSelection, OpenMediaPickerOptions } from "@/components/media/media-manager-surface";
import type { AiRunResult, AiTextToolApplyAction } from "@/lib/ai-contracts";

type MediaLibraryItem = {
  id: number;
  url: string;
  label: string | null;
  mimeType: string | null;
};

export type EditorPluginTabDescriptor = PluginEditorTab & {
  pluginId: string;
  pluginName: string;
};

type Props = {
  tab: EditorPluginTabDescriptor;
  canEdit: boolean;
  siteId: string;
  postId: string;
  dataDomainKey: string;
  metaEntries: EditorMetaEntry[];
  mediaItems: MediaLibraryItem[];
  onMetaEntriesChange: (next: EditorMetaEntry[], immediate?: boolean) => void;
  openMediaPicker: (options: OpenMediaPickerOptions) => void;
  getEditorSelectionText: () => string;
  getEditorContentText: () => string;
  onApplyAiText: (action: AiTextToolApplyAction, text: string) => void;
};

type AiTextToolFragment = Extract<PluginEditorTabFragment, { kind: "text-tool" }>;

function buildEmptyRepeaterRow(fields: PluginEditorTabField[]) {
  return Object.fromEntries(
    fields.map((field) => {
      if (field.type === "checkbox") return [field.key, false];
      if (field.type === "media") {
        return [field.key, { mediaId: "", url: "", mimeType: "", label: "" }];
      }
      return [field.key, String(field.defaultValue ?? "")];
    }),
  );
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function normalizeMediaValue(value: unknown): EditorPluginTabMediaValue {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    mediaId: String(input.mediaId ?? ""),
    url: String(input.url ?? ""),
    mimeType: String(input.mimeType ?? ""),
    label: String(input.label ?? ""),
  };
}

function PluginField({
  field,
  pluginId,
  metaEntries,
  canEdit,
  siteId,
  mediaItems,
  onMetaEntriesChange,
  openMediaPicker,
}: {
  field: PluginEditorTabField;
  pluginId: string;
  metaEntries: EditorMetaEntry[];
  canEdit: boolean;
  siteId: string;
  mediaItems: MediaLibraryItem[];
  onMetaEntriesChange: (next: EditorMetaEntry[], immediate?: boolean) => void;
  openMediaPicker: (options: OpenMediaPickerOptions) => void;
}) {
  const value = readPluginEditorFieldValue(metaEntries, pluginId, field);

  const persist = (nextValue: unknown, immediate = true) => {
    onMetaEntriesChange(writePluginEditorFieldValue(metaEntries, pluginId, field, nextValue), immediate);
  };

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-2 text-xs text-stone-700">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={!canEdit}
          onChange={(event) => persist(event.target.checked)}
          className="h-4 w-4 accent-black"
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{field.label}</span>
        <textarea
          rows={field.rows ?? 4}
          value={String(value || "")}
          disabled={!canEdit}
          placeholder={field.placeholder}
          onChange={(event) => persist(event.target.value, false)}
          onBlur={(event) => persist(event.target.value)}
          className="w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-xs text-stone-900"
        />
        {field.helpText ? <p className="text-[11px] text-stone-500">{field.helpText}</p> : null}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{field.label}</span>
        <select
          value={String(value || field.defaultValue || "")}
          disabled={!canEdit}
          onChange={(event) => persist(event.target.value)}
          className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
        >
          <option value="">Select</option>
          {(field.options || []).map((option) => (
            <option key={`${field.key}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.helpText ? <p className="text-[11px] text-stone-500">{field.helpText}</p> : null}
      </label>
    );
  }

  if (field.type === "radio") {
    return (
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{field.label}</legend>
        <div className="space-y-1">
          {(field.options || []).map((option) => (
            <label
              key={`${field.key}-${option.value}`}
              className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-2 text-xs text-stone-700"
            >
              <input
                type="radio"
                name={`${pluginId}-${field.key}`}
                value={option.value}
                checked={String(value || field.defaultValue || "") === option.value}
                disabled={!canEdit}
                onChange={() => persist(option.value)}
                className="h-4 w-4 accent-black"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {field.helpText ? <p className="text-[11px] text-stone-500">{field.helpText}</p> : null}
      </fieldset>
    );
  }

  if (field.type === "media") {
    const mediaValue = normalizeMediaValue(value);
    const selectedMedia =
      mediaItems.find((item) => String(item.id) === mediaValue.mediaId) || null;
    return (
      <div className="space-y-2 rounded-md border border-stone-200 bg-white p-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{field.label}</div>
        <div className="rounded border border-dashed border-stone-300 bg-stone-50 px-2 py-2 text-xs text-stone-700">
          {mediaValue.url ? (
            <div className="space-y-1">
              <div className="font-semibold">{mediaValue.label || selectedMedia?.label || "Selected media"}</div>
              <div className="truncate text-[11px] text-stone-500">{mediaValue.url}</div>
            </div>
          ) : (
            <span>No media selected.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canEdit || !siteId}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() =>
              openMediaPicker({
                siteId,
                title: field.label,
                mode: "pick",
                allowUpload: canEdit,
                selectedIds: mediaValue.mediaId ? [mediaValue.mediaId] : [],
                onSelect: (items: MediaSelection[]) => {
                  const selected = items[0];
                  if (!selected) return;
                  persist({
                    mediaId: String(selected.mediaId || ""),
                    url: String(selected.url || ""),
                    mimeType: String(selected.mimeType || ""),
                    label: String(selected.label || ""),
                  });
                },
              })
            }
          >
            Choose Media
          </button>
          <button
            type="button"
            disabled={!canEdit || (!mediaValue.mediaId && !mediaValue.url)}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => persist({ mediaId: "", url: "", mimeType: "", label: "" })}
          >
            Clear
          </button>
        </div>
        {field.helpText ? <p className="text-[11px] text-stone-500">{field.helpText}</p> : null}
      </div>
    );
  }

  if (field.type === "repeater") {
    const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
    const subfields = Array.isArray(field.fields) ? field.fields : [];
    return (
      <RepeaterField
        field={field}
        rows={rows}
        subfields={subfields}
        canEdit={canEdit}
        onChange={(nextRows) => persist(nextRows)}
        openMediaPicker={openMediaPicker}
        siteId={siteId}
      />
    );
  }

  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{field.label}</span>
      <input
        type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"}
        value={String(value || "")}
        disabled={!canEdit}
        placeholder={field.placeholder}
        onChange={(event) => persist(event.target.value, false)}
        onBlur={(event) => persist(event.target.value)}
        className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
      />
      {field.helpText ? <p className="text-[11px] text-stone-500">{field.helpText}</p> : null}
    </label>
  );
}

function RepeaterField({
  field,
  rows,
  subfields,
  canEdit,
  onChange,
  openMediaPicker,
  siteId,
}: {
  field: PluginEditorTabField;
  rows: Array<Record<string, unknown>>;
  subfields: PluginEditorTabField[];
  canEdit: boolean;
  onChange: (nextRows: Array<Record<string, unknown>>) => void;
  openMediaPicker: (options: OpenMediaPickerOptions) => void;
  siteId: string;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const updateRow = (rowIndex: number, key: string, nextValue: unknown) => {
    const next = rows.map((row, index) => (index === rowIndex ? { ...row, [key]: nextValue } : row));
    onChange(next);
  };

  return (
    <div className="space-y-2 rounded-md border border-stone-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{field.label}</div>
          {field.helpText ? <p className="text-[11px] text-stone-500">{field.helpText}</p> : null}
        </div>
        <button
          type="button"
          disabled={!canEdit}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => onChange([...rows, buildEmptyRepeaterRow(subfields)])}
        >
          Add Row
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-stone-300 px-2 py-3 text-xs text-stone-500">No entries yet.</p>
      ) : null}
      <div className="space-y-3">
        {rows.map((row, rowIndex) => (
          <section
            key={`${field.key}-${rowIndex}`}
            draggable={canEdit}
            onDragStart={() => setDragIndex(rowIndex)}
            onDragOver={(event) => {
              if (canEdit) event.preventDefault();
            }}
            onDrop={() => {
              if (!canEdit || dragIndex === null || dragIndex === rowIndex) return;
              onChange(moveItem(rows, dragIndex, rowIndex));
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={cn(
              "space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2",
              dragIndex === rowIndex ? "border-stone-400" : "",
            )}
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Row {rowIndex + 1}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!canEdit || rowIndex === 0}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onChange(moveItem(rows, rowIndex, rowIndex - 1))}
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={!canEdit || rowIndex === rows.length - 1}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onChange(moveItem(rows, rowIndex, rowIndex + 1))}
                >
                  Down
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  className="rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}
                >
                  Remove
                </button>
              </div>
            </div>
            {subfields.map((subfield) => {
              const currentValue = row[subfield.key];
              if (subfield.type === "checkbox") {
                return (
                  <label
                    key={`${field.key}-${rowIndex}-${subfield.key}`}
                    className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-2 text-xs text-stone-700"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(currentValue)}
                      disabled={!canEdit}
                      onChange={(event) => updateRow(rowIndex, subfield.key, event.target.checked)}
                      className="h-4 w-4 accent-black"
                    />
                    <span>{subfield.label}</span>
                  </label>
                );
              }
              if (subfield.type === "textarea") {
                return (
                  <label key={`${field.key}-${rowIndex}-${subfield.key}`} className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{subfield.label}</span>
                    <textarea
                      rows={subfield.rows ?? 4}
                      value={String(currentValue || "")}
                      disabled={!canEdit}
                      placeholder={subfield.placeholder}
                      onChange={(event) => updateRow(rowIndex, subfield.key, event.target.value)}
                      className="w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-xs text-stone-900"
                    />
                  </label>
                );
              }
              if (subfield.type === "select" || subfield.type === "radio") {
                const choice = String(currentValue || subfield.defaultValue || "");
                return (
                  <label key={`${field.key}-${rowIndex}-${subfield.key}`} className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{subfield.label}</span>
                    <select
                      value={choice}
                      disabled={!canEdit}
                      onChange={(event) => updateRow(rowIndex, subfield.key, event.target.value)}
                      className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                    >
                      <option value="">Select</option>
                      {(subfield.options || []).map((option) => (
                        <option key={`${field.key}-${rowIndex}-${subfield.key}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              if (subfield.type === "media") {
                const mediaValue = normalizeMediaValue(currentValue);
                return (
                  <div key={`${field.key}-${rowIndex}-${subfield.key}`} className="space-y-2 rounded-md border border-stone-200 bg-white p-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{subfield.label}</div>
                    <div className="rounded border border-dashed border-stone-300 bg-stone-50 px-2 py-2 text-xs text-stone-700">
                      {mediaValue.url ? (
                        <div className="space-y-1">
                          <div className="font-semibold">{mediaValue.label || "Selected media"}</div>
                          <div className="truncate text-[11px] text-stone-500">{mediaValue.url}</div>
                        </div>
                      ) : (
                        <span>No media selected.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!canEdit || !siteId}
                        className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() =>
                          openMediaPicker({
                            siteId,
                            title: subfield.label,
                            mode: "pick",
                            allowUpload: canEdit,
                            selectedIds: mediaValue.mediaId ? [mediaValue.mediaId] : [],
                            onSelect: (items: MediaSelection[]) => {
                              const selected = items[0];
                              if (!selected) return;
                              updateRow(rowIndex, subfield.key, {
                                mediaId: String(selected.mediaId || ""),
                                url: String(selected.url || ""),
                                mimeType: String(selected.mimeType || ""),
                                label: String(selected.label || ""),
                              });
                            },
                          })
                        }
                      >
                        Choose Media
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || (!mediaValue.mediaId && !mediaValue.url)}
                        className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => updateRow(rowIndex, subfield.key, { mediaId: "", url: "", mimeType: "", label: "" })}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <label key={`${field.key}-${rowIndex}-${subfield.key}`} className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">{subfield.label}</span>
                  <input
                    type="text"
                    value={String(currentValue || "")}
                    disabled={!canEdit}
                    placeholder={subfield.placeholder}
                    onChange={(event) => updateRow(rowIndex, subfield.key, event.target.value)}
                    className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                  />
                </label>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function AiTextToolPanel({
  fragment,
  pluginId,
  siteId,
  postId,
  dataDomainKey,
  canEdit,
  getEditorSelectionText,
  getEditorContentText,
  onApplyAiText,
}: {
  fragment: AiTextToolFragment;
  pluginId: string;
  siteId: string;
  postId: string;
  dataDomainKey: string;
  canEdit: boolean;
  getEditorSelectionText: () => string;
  getEditorContentText: () => string;
  onApplyAiText: (action: AiTextToolApplyAction, text: string) => void;
}) {
  const [instructionText, setInstructionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [result, setResult] = useState<AiRunResult | null>(null);

  const sourceText = fragment.source === "selection" ? getEditorSelectionText() : getEditorContentText();
  const contextText = fragment.source === "selection" ? getEditorContentText() : "";
  const requestPreview = JSON.stringify(
    {
      scope: siteId ? { kind: "site", siteId } : null,
      action: fragment.action,
      input: {
        sourceText,
        instructionText: instructionText || undefined,
        contextText: contextText || undefined,
      },
      context: {
        surface: "editor_assist",
        pluginId,
        postId,
        dataDomainKey,
      },
    },
    null,
    2,
  );

  const canSubmit = Boolean(canEdit && siteId && sourceText.trim() && !submitting);

  async function runTool() {
    const nextSourceText = fragment.source === "selection" ? getEditorSelectionText() : getEditorContentText();
    const nextContextText = fragment.source === "selection" ? getEditorContentText() : "";
    if (!nextSourceText.trim()) {
      setRequestError(
        fragment.source === "selection"
          ? "Select some editor text before running this tool."
          : "This tool needs editor content before it can run.",
      );
      setResult(null);
      return;
    }

    setSubmitting(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/ai/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: { kind: "site", siteId },
          action: fragment.action,
          input: {
            sourceText: nextSourceText,
            instructionText: instructionText || undefined,
            contextText: nextContextText || undefined,
          },
          context: {
            surface: "editor_assist",
            pluginId,
            postId,
            dataDomainKey,
          },
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

  const outputText = result && result.ok && result.output?.kind === "text" ? result.output.text : "";

  return (
    <div className="space-y-3 rounded-md border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">{fragment.title}</div>
          <p className="mt-1 text-xs text-stone-500">
            Source: {fragment.source === "selection" ? "current selection" : "full entry"} · Action: {fragment.action}
          </p>
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={runTool}
          className="rounded border border-black bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Running..." : fragment.submitLabel || "Run Tool"}
        </button>
      </div>

      {!siteId ? (
        <div className="rounded border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-xs text-stone-500">
          Select a site before running AI editor tools.
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Instruction</span>
        <textarea
          rows={3}
          value={instructionText}
          disabled={!canEdit}
          onChange={(event) => setInstructionText(event.target.value)}
          placeholder={fragment.instructionPlaceholder || "Describe what you want the tool to do."}
          className="w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-xs text-stone-900"
        />
      </label>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Request Preview</div>
        <pre className="overflow-x-auto rounded-md bg-stone-950 px-3 py-2 text-[11px] text-stone-100">
          <code>{requestPreview}</code>
        </pre>
      </div>

      {requestError ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{requestError}</div>
      ) : null}

      {!result ? null : result.ok === false ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{result.error}</div>
      ) : result.decision === "reject" ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The core guard rejected this output. Trace ID: {result.traceId}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded border border-stone-200 bg-stone-50 px-3 py-3 text-xs whitespace-pre-wrap text-stone-800">
            {outputText}
          </div>
          <div className="flex flex-wrap gap-2">
            {fragment.applyActions.map((action) => (
              <button
                key={`${fragment.toolId}-${action}`}
                type="button"
                disabled={!canEdit || !outputText}
                onClick={() => onApplyAiText(action, outputText)}
                className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {action === "replace_selection" ? "Replace Selection" : "Insert Below"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-500">
            Decision: {result.decision} · Provider: {result.providerId} · Trace ID: {result.traceId}
          </p>
        </div>
      )}
    </div>
  );
}

export default function PluginEditorTabPanel({
  tab,
  canEdit,
  siteId,
  postId,
  dataDomainKey,
  metaEntries,
  mediaItems,
  onMetaEntriesChange,
  openMediaPicker,
  getEditorSelectionText,
  getEditorContentText,
  onApplyAiText,
}: Props) {
  return (
    <fieldset disabled={!canEdit} className="mt-4 min-w-0 max-w-full space-y-3 overflow-x-hidden">
      {tab.sections.map((section) => (
        <section key={`${tab.pluginId}-${tab.id}-${section.id}`} className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">{section.title}</div>
            {section.description ? <p className="mt-1 text-xs text-stone-500">{section.description}</p> : null}
          </div>
          {section.fragment?.kind === "html" && section.fragment.html ? (
            <div
              className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700"
              dangerouslySetInnerHTML={{ __html: section.fragment.html }}
            />
          ) : null}
          {section.fragment?.kind === "text-tool" ? (
            <AiTextToolPanel
              fragment={section.fragment}
              pluginId={tab.pluginId}
              siteId={siteId}
              postId={postId}
              dataDomainKey={dataDomainKey}
              canEdit={canEdit}
              getEditorSelectionText={getEditorSelectionText}
              getEditorContentText={getEditorContentText}
              onApplyAiText={onApplyAiText}
            />
          ) : null}
          {(section.fields || []).map((field) => (
            <PluginField
              key={`${tab.pluginId}-${tab.id}-${section.id}-${field.key}`}
              field={field}
              pluginId={tab.pluginId}
              metaEntries={metaEntries}
              canEdit={canEdit}
              siteId={siteId}
              mediaItems={mediaItems}
              onMetaEntriesChange={onMetaEntriesChange}
              openMediaPicker={openMediaPicker}
            />
          ))}
        </section>
      ))}
    </fieldset>
  );
}
