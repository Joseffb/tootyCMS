"use client";

import { useMemo, useState } from "react";

type Provider = {
  id: string;
  label?: string;
  version?: string;
  source?: string;
  enabled?: boolean;
  capabilities?: { export?: boolean; import?: boolean; inspect?: boolean; apply?: boolean };
};

type Props = {
  siteId?: string | null;
  providers: Provider[];
};

type MediaItem = {
  id: number;
  url: string;
  label?: string | null;
  mimeType?: string | null;
};

type RowState = {
  mode: "import" | "export";
  providerId: string;
};

export default function MigrationKitConsole({ siteId, providers }: Props) {
  const [active, setActive] = useState<RowState | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string>("");
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportOptionsText, setExportOptionsText] = useState("{}");
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);

  const enabledProviders = useMemo(
    () => (providers || []).filter((provider) => provider.enabled !== false),
    [providers],
  );

  const runAction = async (payload: Record<string, unknown>) => {
    setError("");
    setResult(null);
    const response = await fetch("/api/plugins/export-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json?.ok === false) {
      const message = String(json?.error || `Request failed (${response.status})`);
      throw new Error(message);
    }
    return json;
  };

  const resolveImportPayload = async () => {
    if (importFile) return await importFile.text();
    if (importText.trim()) return importText;
    return null;
  };

  const parseExportOptions = () => {
    const text = exportOptionsText.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      throw new Error("Export options must be valid JSON.");
    }
  };

  const loadMediaItems = async () => {
    if (!siteId) throw new Error("Media Manager requires a site context.");
    setMediaLoading(true);
    try {
      const response = await fetch(`/api/media?siteId=${encodeURIComponent(siteId)}&limit=50`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(json?.error || `Media load failed (${response.status})`));
      }
      const items = Array.isArray(json?.items) ? (json.items as MediaItem[]) : [];
      setMediaItems(items);
      if (items[0]?.url) {
        setSelectedMediaUrl(items[0].url);
      }
    } finally {
      setMediaLoading(false);
    }
  };

  const uploadImportFileToMedia = async () => {
    if (!siteId) throw new Error("Upload requires a site context.");
    if (!importFile) throw new Error("Choose a file first.");
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("siteId", siteId);
      formData.append("name", importFile.name || "migration-import");
      const response = await fetch("/api/media/upload-file", {
        method: "POST",
        body: formData,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(json?.error || `Upload failed (${response.status})`));
      }
      const uploadedUrl = String(json?.url || "").trim();
      if (!uploadedUrl) throw new Error("Upload succeeded but no URL was returned.");
      setImportUrl(uploadedUrl);
      setSelectedMediaUrl(uploadedUrl);
      await loadMediaItems().catch(() => {});
    } finally {
      setUploadingFile(false);
    }
  };

  const runImport = async (providerId: string, apply: boolean) => {
    const payload = await resolveImportPayload();
    const urlToUse = importUrl.trim() || selectedMediaUrl.trim();
    if (!payload && !urlToUse) {
      throw new Error("Upload a file, paste payload JSON, or provide an import URL.");
    }
    return runAction({
      action: apply ? "import.apply" : "import.inspect",
      siteId: siteId || null,
      format: providerId,
      payload,
      payloadUrl: urlToUse || null,
    });
  };

  const runExport = async (providerId: string) => {
    return runAction({
      action: "export",
      siteId: siteId || null,
      format: providerId,
      options: parseExportOptions(),
    });
  };

  const handleImport = async (providerId: string, apply: boolean) => {
    const marker = `${providerId}:${apply ? "import" : "dry-run"}`;
    setBusy(marker);
    try {
      const json = await runImport(providerId, apply);
      setResult(json);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Import request failed.");
    } finally {
      setBusy("");
    }
  };

  const handleExportDryRun = async (providerId: string) => {
    const marker = `${providerId}:export-dry`;
    setBusy(marker);
    try {
      const json = await runExport(providerId);
      setResult(json);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Export dry-run failed.");
    } finally {
      setBusy("");
    }
  };

  const handleExportDownload = async (providerId: string) => {
    const marker = `${providerId}:export`;
    setBusy(marker);
    try {
      const json = await runExport(providerId);
      setResult(json);
      const fileName = `${providerId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
      <div>
        <h2 className="font-cal text-xl dark:text-white">Enabled Formats</h2>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Choose a format, then run import or export operations.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {enabledProviders.map((provider) => {
              const isImportOpen = active?.providerId === provider.id && active.mode === "import";
              const isExportOpen = active?.providerId === provider.id && active.mode === "export";
              return (
                <tr key={provider.id} className="border-t border-stone-200 align-top dark:border-stone-700">
                  <td className="px-3 py-2">
                    <div className="font-medium text-stone-900 dark:text-stone-100">{provider.label || provider.id}</div>
                    <div className="text-xs text-stone-500">{provider.id}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600 dark:text-stone-300">
                    {provider.source || "plugin"} {provider.version ? `v${provider.version}` : ""}
                    <br />
                    {[
                      provider.capabilities?.export ? "export" : null,
                      provider.capabilities?.import ? "import" : null,
                      provider.capabilities?.inspect ? "inspect" : null,
                      provider.capabilities?.apply ? "apply" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "no capabilities declared"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setActive(isImportOpen ? null : { providerId: provider.id, mode: "import" })
                        }
                        className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs font-semibold text-white"
                      >
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setActive(isExportOpen ? null : { providerId: provider.id, mode: "export" })
                        }
                        className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs font-semibold text-white"
                      >
                        Export
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {enabledProviders.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-sm text-stone-500 dark:text-stone-400">
                  No enabled formats found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {active ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-900">
          <h3 className="font-cal text-lg text-stone-900 dark:text-stone-100">
            {active.mode === "import" ? "Import" : "Export"}: {active.providerId}
          </h3>

          {active.mode === "import" ? (
            <div className="mt-3 grid gap-3">
              <label className="text-sm text-stone-800 dark:text-stone-100">
                File Upload
                <input
                  type="file"
                  onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await uploadImportFileToMedia();
                    } catch (err: any) {
                      setError(err instanceof Error ? err.message : "Failed uploading import file.");
                    }
                  }}
                  disabled={!siteId || !importFile || uploadingFile}
                  className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {uploadingFile ? "Uploading..." : "Upload To Media"}
                </button>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Stores file in active media provider (blob/s3/dbblob), then uses that URL.
                </p>
              </div>
              <label className="text-sm text-stone-800 dark:text-stone-100">
                Import URL
                <input
                  type="url"
                  value={importUrl}
                  onChange={(event) => setImportUrl(event.target.value)}
                  placeholder="https://example.com/export.json"
                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </label>
              <div className="rounded-md border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-black">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm text-stone-800 dark:text-stone-100">Media Manager</p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await loadMediaItems();
                      } catch (err: any) {
                        setError(err instanceof Error ? err.message : "Failed to load media.");
                      }
                    }}
                    disabled={!siteId || mediaLoading}
                    className="rounded-md border border-stone-700 bg-stone-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {mediaLoading ? "Loading..." : "Load Media"}
                  </button>
                </div>
                {!siteId ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Open this plugin with `?siteId=&lt;site-id&gt;` to pick from site media.
                  </p>
                ) : mediaItems.length === 0 ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    No loaded media yet.
                  </p>
                ) : (
                  <label className="text-xs text-stone-700 dark:text-stone-300">
                    Choose existing file URL
                    <select
                      value={selectedMediaUrl}
                      onChange={(event) => setSelectedMediaUrl(event.target.value)}
                      className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                    >
                      {mediaItems.map((item) => (
                        <option key={item.id} value={item.url}>
                          {(item.label || item.url).slice(0, 90)} {item.mimeType ? `(${item.mimeType})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <label className="text-sm text-stone-800 dark:text-stone-100">
                Import JSON (optional)
                <textarea
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  rows={6}
                  placeholder='{"manifest": {"schemaVersion": "1"}}'
                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleImport(active.providerId, false)}
                  disabled={Boolean(busy)}
                  className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === `${active.providerId}:dry-run` ? "Running..." : "Dry Run"}
                </button>
                <button
                  type="button"
                  onClick={() => handleImport(active.providerId, true)}
                  disabled={Boolean(busy)}
                  className="rounded-md border border-black bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === `${active.providerId}:import` ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              <label className="text-sm text-stone-800 dark:text-stone-100">
                Export Options (JSON)
                <textarea
                  value={exportOptionsText}
                  onChange={(event) => setExportOptionsText(event.target.value)}
                  rows={6}
                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportDryRun(active.providerId)}
                  disabled={Boolean(busy)}
                  className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === `${active.providerId}:export-dry` ? "Running..." : "Dry Run"}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportDownload(active.providerId)}
                  disabled={Boolean(busy)}
                  className="rounded-md border border-black bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === `${active.providerId}:export` ? "Exporting..." : "Export"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-black">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Result</p>
          <pre className="max-h-80 overflow-auto text-xs text-stone-700 dark:text-stone-200">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
