"use client";

import { useEffect, useMemo, useState } from "react";

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

type DryRunReport = {
  title: string;
  lines: string[];
  warnings: string[];
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function describeUsersBand(value: unknown) {
  const band = String(value || "unknown").toLowerCase();
  if (band === "none") return "none";
  if (band === "very-low") return "small circulation";
  if (band === "low") return "medium circulation";
  if (band === "medium") return "large circulation";
  if (band === "high") return "enormous circulation";
  return "unknown";
}

function buildDryRunReport(result: Record<string, unknown>): DryRunReport | null {
  if (result.ok !== true) return null;
  const directReport = toRecord(result.report);
  if (directReport) {
    const estimated = toRecord(directReport.estimatedVolumes);
    const includes = toRecord(directReport.includes);
    const formatFamily = String(directReport.formatFamily || "generic");
    const lines: string[] = [];
    const scopeRaw = String(directReport.scope || "unknown");
    const scopeLabel =
      scopeRaw === "site-entire"
        ? "Site (entire snapshot)"
        : scopeRaw === "network-entire"
          ? "Network (entire snapshot)"
          : scopeRaw;
    lines.push(`Scope: ${scopeLabel}`);
    lines.push(`Format: ${String(result.format || "unknown")}`);
    if (formatFamily === "snapshot") {
      lines.push("Snapshot scope: entire site");
      if (estimated) {
        lines.push(`Estimated domain volume: ${String(estimated.availableDomainsBand || "unknown")}`);
        lines.push(`Estimated entry volume: ${String(estimated.articlesBand || "unknown")}`);
        lines.push(`Estimated users depth: ${describeUsersBand(estimated.usersBand)}`);
        lines.push(`Estimated media item volume: ${String(estimated.mediaItemsBand || "unknown")}`);
        lines.push(`Estimated media size footprint: ${String(estimated.mediaSizeBand || "unknown")}`);
      }
      if (includes) {
        lines.push(`Include settings: ${includes.settings ? "yes" : "no"}`);
        lines.push(`Media mode: ${String(includes.mediaMode || "unknown")}`);
        lines.push(`Users mode: ${String(includes.usersMode || "unknown")}`);
      }
    } else {
      lines.push(`Domain selection: ${String(directReport.selectedDomainCountBand || "unknown")}`);
      if (estimated) {
        lines.push(`Estimated domain volume: ${String(estimated.availableDomainsBand || "unknown")}`);
        lines.push(`Estimated article volume: ${String(estimated.articlesBand || "unknown")}`);
      }
      if (includes) {
        lines.push(`Include content: ${includes.content ? "yes" : "no"}`);
        lines.push(`Include SEO: ${includes.seo ? "yes" : "no"}`);
        lines.push(`Meta mode: ${String(includes.metaMode || "none")}`);
      }
    }
    return {
      title: "Dry Run Preview",
      lines,
      warnings: [
        ...toStringList(directReport.notes),
        ...toStringList(result.warnings),
      ],
    };
  }
  const payload = toRecord(result.payload);
  const options = toRecord(result.options);
  const provider = toRecord(result.provider);

  const format = String(result.format || provider?.id || "").trim();
  const generatedAt = String(result.generatedAt || "").trim();
  const scopeSiteId = String(result.siteId || "").trim();
  const scope = scopeSiteId ? `Site (${scopeSiteId})` : "Network";
  const deliveryEmail = String(options?.deliveryEmail || "").trim();

  const includeDomains = toStringList(payload?.includeDomains || options?.domains);
  const availableDomains = Array.isArray(payload?.availableDomains) ? payload?.availableDomains.length : 0;
  const articlesCount = Array.isArray(payload?.articles) ? payload?.articles.length : 0;
  const warnings = toStringList(result.warnings);

  const lines: string[] = [];
  lines.push(`Scope: ${scope}`);
  if (format) lines.push(`Format: ${format}`);
  if (generatedAt) lines.push(`Generated: ${new Date(generatedAt).toLocaleString()}`);
  if (deliveryEmail) lines.push(`Delivery email: ${deliveryEmail}`);
  if (includeDomains.length > 0) lines.push(`Domains selected: ${includeDomains.join(", ")}`);
  lines.push(`Domains available (estimate): ${availableDomains > 25 ? "high" : availableDomains > 5 ? "medium" : availableDomains > 0 ? "low" : "none"}`);
  lines.push(`Articles matching filter (estimate): ${articlesCount > 100 ? "high" : articlesCount > 25 ? "medium" : articlesCount > 0 ? "low" : "none"}`);
  if (options?.entryStates) lines.push(`Entry states: ${String(options.entryStates)}`);
  if (options?.includeContent !== undefined) lines.push(`Include content: ${options.includeContent ? "yes" : "no"}`);
  if (options?.includeMeta !== undefined) lines.push(`Meta export mode: ${String(options.includeMeta)}`);

  return {
    title: "Dry Run Preview",
    lines,
    warnings,
  };
}

export default function MigrationKitConsole({ siteId, providers }: Props) {
  const [active, setActive] = useState<RowState | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [showDryRunPreview, setShowDryRunPreview] = useState(false);
  const [error, setError] = useState<string>("");
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportVerificationRequired, setExportVerificationRequired] = useState(false);
  const [exportDeliveryEmail, setExportDeliveryEmail] = useState("");
  const [exportVerificationCode, setExportVerificationCode] = useState("");
  const [exportVerificationHint, setExportVerificationHint] = useState("");
  const [exportVerificationExpiresAt, setExportVerificationExpiresAt] = useState("");
  const [exportReason, setExportReason] = useState("");
  const [exportCompression, setExportCompression] = useState<"none" | "gzip">("none");
  const [exportIncludeChecksums, setExportIncludeChecksums] = useState(true);
  const [exportIncludeSchemaVersion, setExportIncludeSchemaVersion] = useState(true);
  const [exportTimezone, setExportTimezone] = useState<"UTC" | "site-local">("UTC");
  const [exportLocale, setExportLocale] = useState("");
  const [snapshotIncludeSettings, setSnapshotIncludeSettings] = useState(true);
  const [snapshotIncludeRolesCapabilities, setSnapshotIncludeRolesCapabilities] = useState(true);
  const [snapshotIncludeDomains, setSnapshotIncludeDomains] = useState(true);
  const [snapshotIncludeEntries, setSnapshotIncludeEntries] = useState(true);
  const [snapshotIncludeDomainMeta, setSnapshotIncludeDomainMeta] = useState(true);
  const [snapshotIncludeTaxonomies, setSnapshotIncludeTaxonomies] = useState(true);
  const [snapshotIncludeTermMeta, setSnapshotIncludeTermMeta] = useState(true);
  const [snapshotIncludeMenus, setSnapshotIncludeMenus] = useState(true);
  const [snapshotIncludeThemes, setSnapshotIncludeThemes] = useState(true);
  const [snapshotIncludeThemeConfig, setSnapshotIncludeThemeConfig] = useState(true);
  const [snapshotIncludePlugins, setSnapshotIncludePlugins] = useState(true);
  const [snapshotIncludePluginConfig, setSnapshotIncludePluginConfig] = useState(true);
  const [snapshotIncludeSchedules, setSnapshotIncludeSchedules] = useState(true);
  const [snapshotIncludeWebhooks, setSnapshotIncludeWebhooks] = useState(true);
  const [snapshotIncludeUsers, setSnapshotIncludeUsers] = useState<"none" | "site-users" | "all-users">("site-users");
  const [snapshotIncludeMedia, setSnapshotIncludeMedia] = useState<"references" | "with-manifest" | "with-binaries">("references");
  const [snapshotIncludeAnalytics, setSnapshotIncludeAnalytics] = useState<"none" | "summary" | "full">("none");
  const [articlesIncludeContent, setArticlesIncludeContent] = useState(true);
  const [articlesIncludeExcerpt, setArticlesIncludeExcerpt] = useState(true);
  const [articlesIncludeSeo, setArticlesIncludeSeo] = useState(true);
  const [articlesIncludeFeaturedMedia, setArticlesIncludeFeaturedMedia] = useState(true);
  const [articlesIncludeMediaManifest, setArticlesIncludeMediaManifest] = useState(false);
  const [articlesDomainsCsv, setArticlesDomainsCsv] = useState("post,page");
  const [articlesEntryStates, setArticlesEntryStates] = useState<"published" | "draft" | "scheduled" | "all">("published");
  const [articlesTaxonomies, setArticlesTaxonomies] = useState<"none" | "attached-only" | "full-definitions">("attached-only");
  const [articlesIncludeMeta, setArticlesIncludeMeta] = useState<"none" | "selected" | "all">("selected");
  const [articlesMetaKeysCsv, setArticlesMetaKeysCsv] = useState("");
  const [articlesAuthorsCsv, setArticlesAuthorsCsv] = useState("");
  const [articlesDateFrom, setArticlesDateFrom] = useState("");
  const [articlesDateTo, setArticlesDateTo] = useState("");
  const [showAdvancedExportOptions, setShowAdvancedExportOptions] = useState(false);
  const [showCommonExportOptions, setShowCommonExportOptions] = useState(false);
  const [showSnapshotExportOptions, setShowSnapshotExportOptions] = useState(false);
  const [showArticlesExportOptions, setShowArticlesExportOptions] = useState(false);
  const [exportOutputFormat, setExportOutputFormat] = useState("json");
  const [exportOptionsText, setExportOptionsText] = useState("{}");
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);

  const enabledProviders = useMemo(
    () => (providers || []).filter((provider) => provider.enabled !== false),
    [providers],
  );
  const report = useMemo(() => (result ? buildDryRunReport(result) : null), [result]);

  useEffect(() => {
    let cancelled = false;
    const loadSessionEmail = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const json = (await response.json().catch(() => ({}))) as Record<string, any>;
        const email = String(json?.user?.email || "").trim();
        if (!cancelled && email) {
          setExportDeliveryEmail((prev) => (prev.trim() ? prev : email));
        }
      } catch {
        // Optional prefill only.
      }
    };
    loadSessionEmail();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active || active.mode !== "export") return;
    void (async () => {
      const response = await fetch("/api/plugins/export-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export.status",
          siteId: siteId || null,
          format: active.providerId,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || json?.ok === false) return;
      const pending = Boolean(json?.requiresVerification) || Boolean(json?.pending);
      setExportVerificationRequired(pending);
      if (!pending) {
        setExportVerificationCode("");
        setExportVerificationHint("");
        setExportVerificationExpiresAt("");
        return;
      }
      const sentTo = String(json?.sentTo || "").trim();
      setExportVerificationHint(
        sentTo
          ? `A verification code was sent to ${sentTo}. Enter the code to continue.`
          : "A verification code was sent to administrators. Enter the code to continue.",
      );
      setExportVerificationExpiresAt(String(json?.expiresAt || "").trim());
    })();
  }, [active?.mode, active?.providerId, siteId]);

  const runAction = async (payload: Record<string, unknown>) => {
    setError("");
    setResult(null);
    setExportVerificationHint("");
    const response = await fetch("/api/plugins/export-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json?.ok === false) {
      if (Boolean(json?.requiresVerification)) {
        setExportVerificationRequired(true);
        const sentTo = String(json?.sentTo || "").trim();
        setExportVerificationHint(
          sentTo
            ? `A verification code was sent to ${sentTo}. Enter the code to continue.`
            : "A verification code was sent to administrators. Enter the code to continue.",
        );
        setExportVerificationExpiresAt(String(json?.expiresAt || "").trim());
      }
      const message = String(json?.error || `Request failed (${response.status})`);
      const err = new Error(message) as Error & { requiresVerification?: boolean };
      err.requiresVerification = Boolean(json?.requiresVerification);
      throw err;
    }
    return json;
  };

  const runExportRequest = async (providerId: string) => {
    const options = buildExportOptions(providerId);
    return await fetch("/api/plugins/export-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "export",
        siteId: siteId || null,
        format: providerId,
        exportReason: exportReason.trim(),
        deliveryEmail: exportDeliveryEmail.trim() || null,
        verificationCode: exportVerificationCode.trim() || null,
        ...(options ? { options } : {}),
      }),
    });
  };

  const cancelExportVerification = async (providerId: string) => {
    const response = await fetch("/api/plugins/export-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "export.cancel",
        siteId: siteId || null,
        format: providerId,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json?.ok === false) {
      throw new Error(String(json?.error || `Cancel failed (${response.status})`));
    }
    setExportVerificationRequired(false);
    setExportVerificationCode("");
    setExportVerificationHint("");
    setExportVerificationExpiresAt("");
  };

  const resolveImportPayload = async () => {
    if (importFile) return await importFile.text();
    if (importText.trim()) return importText;
    return null;
  };

  const splitCsv = (value: string) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const isSnapshotProvider = (providerId: string) => {
    const value = String(providerId || "").toLowerCase();
    return value.includes("snapshot");
  };

  const isArticlesProvider = (providerId: string) => {
    const value = String(providerId || "").toLowerCase();
    return value.includes("article");
  };

  const buildExportOptions = (providerId: string) => {
    const options: Record<string, unknown> = {};
    options.outputFormat = exportOutputFormat.trim().toLowerCase() || "json";
    options.compression = exportCompression;
    if (exportIncludeChecksums) options.includeChecksums = true;
    if (exportIncludeSchemaVersion) options.includeSchemaVersion = true;
    options.timezone = exportTimezone;
    if (exportLocale.trim()) options.locale = exportLocale.trim();
    if (exportDeliveryEmail.trim()) options.deliveryEmail = exportDeliveryEmail.trim().toLowerCase();

    if (isSnapshotProvider(providerId)) {
      options.includeSettings = snapshotIncludeSettings;
      options.includeRolesCapabilities = snapshotIncludeRolesCapabilities;
      options.includeDomains = snapshotIncludeDomains;
      options.includeEntries = snapshotIncludeEntries;
      options.includeDomainMeta = snapshotIncludeDomainMeta;
      options.includeTaxonomies = snapshotIncludeTaxonomies;
      options.includeTermMeta = snapshotIncludeTermMeta;
      options.includeMenus = snapshotIncludeMenus;
      options.includeThemes = snapshotIncludeThemes;
      options.includeThemeConfig = snapshotIncludeThemeConfig;
      options.includePlugins = snapshotIncludePlugins;
      options.includePluginConfig = snapshotIncludePluginConfig;
      options.includeSchedules = snapshotIncludeSchedules;
      options.includeWebhooks = snapshotIncludeWebhooks;
      options.includeUsers = snapshotIncludeUsers;
      options.includeMedia = snapshotIncludeMedia;
      options.includeAnalytics = snapshotIncludeAnalytics;
    } else if (isArticlesProvider(providerId)) {
      options.domains = splitCsv(articlesDomainsCsv);
      options.entryStates = articlesEntryStates;
      options.authors = splitCsv(articlesAuthorsCsv);
      options.taxonomies = articlesTaxonomies;
      options.includeContent = articlesIncludeContent;
      options.includeExcerpt = articlesIncludeExcerpt;
      options.includeSeo = articlesIncludeSeo;
      options.includeMeta = articlesIncludeMeta;
      if (articlesIncludeMeta === "selected") {
        options.metaKeys = splitCsv(articlesMetaKeysCsv);
      }
      options.includeFeaturedMedia = articlesIncludeFeaturedMedia;
      options.includeMediaManifest = articlesIncludeMediaManifest;
      if (articlesDateFrom.trim()) options.dateFrom = articlesDateFrom.trim();
      if (articlesDateTo.trim()) options.dateTo = articlesDateTo.trim();
    }

    if (showAdvancedExportOptions) {
      const text = exportOptionsText.trim();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            Object.assign(options, parsed as Record<string, unknown>);
          }
        } catch {
          throw new Error("Advanced export options JSON must be valid.");
        }
      }
    }

    return Object.keys(options).length > 0 ? options : undefined;
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
    const options = buildExportOptions(providerId);
    return runAction({
      action: "export.inspect",
      siteId: siteId || null,
      exportReason: exportReason.trim(),
      deliveryEmail: exportDeliveryEmail.trim() || null,
      format: providerId,
      verificationCode: exportVerificationCode.trim() || null,
      ...(options ? { options } : {}),
    });
  };

  const handleImport = async (providerId: string, apply: boolean) => {
    const marker = `${providerId}:${apply ? "import" : "dry-run"}`;
    setBusy(marker);
    setShowDryRunPreview(!apply);
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
    if (exportReason.trim().length < 8) {
      setError("Export reason is required (minimum 8 characters).");
      return;
    }
    const marker = `${providerId}:export-dry`;
    setBusy(marker);
    setShowDryRunPreview(true);
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
    if (exportReason.trim().length < 8) {
      setError("Export reason is required (minimum 8 characters).");
      return;
    }
    const marker = `${providerId}:export`;
    setBusy(marker);
    setShowDryRunPreview(false);
    try {
      setError("");
      setResult(null);
      setExportVerificationHint("");
      const response = await runExportRequest(providerId);
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (Boolean(json?.requiresVerification)) {
          setExportVerificationRequired(true);
          const sentTo = String(json?.sentTo || "").trim();
          setExportVerificationHint(
            sentTo
              ? `A verification code was sent to ${sentTo}. Enter the code to continue.`
              : "A verification code was sent to administrators. Enter the code to continue.",
          );
          setExportVerificationExpiresAt(String(json?.expiresAt || "").trim());
        }
        throw new Error(String(json?.error || `Export failed (${response.status})`));
      }
      const isZip = contentType.includes("application/zip");
      const blob = await response.blob();
      const extension = isZip ? "zip" : exportOutputFormat.toLowerCase() === "ndjson" ? "ndjson" : "json";
      const fileName = `${providerId}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
      if (!isZip) {
        try {
          const text = await blob.text();
          const json = JSON.parse(text) as Record<string, unknown>;
          setResult(json);
        } catch {
          setResult({ ok: true, downloaded: true, fileName, contentType });
        }
      } else {
        setResult({ ok: true, downloaded: true, fileName, contentType: "application/zip" });
      }
      setExportVerificationRequired(false);
      setExportVerificationHint("");
      setExportVerificationExpiresAt("");
      setExportVerificationCode("");
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

  const getExportButtonUi = (providerId: string) => {
    if (busy === `${providerId}:export`) {
      return {
        label: "Processing...",
        className: "rounded-md border border-black bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-50",
      };
    }
    if (exportVerificationRequired) {
      return {
        label: "Pending Verification",
        className: "rounded-md border border-amber-600 bg-amber-400 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50",
      };
    }
    return {
      label: "Export",
      className: "rounded-md border border-black bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-50",
    };
  };

  return (
    <section className="space-y-3 rounded-lg border border-stone-300 bg-white p-5 text-black">
      <div>
        <h2 className="font-cal text-xl text-black">Enabled Formats</h2>
        <p className="text-xs text-black">
          Choose a format, then run import or export operations.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-300 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-white text-left text-black">
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
              const isActiveRow = active?.providerId === provider.id;
              return [
                  <tr key={`${provider.id}-base`} className="border-t border-stone-300 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-black">{provider.label || provider.id}</div>
                      <div className="text-xs text-black">{provider.id}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-black">
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
                  </tr>,
                  isActiveRow ? (
                    <tr key={`${provider.id}-panel`} className="border-t border-stone-300 bg-white">
                      <td colSpan={3} className="p-4">
                        <div className="rounded-lg border border-stone-300 bg-white p-4 text-black">
                          <h3 className="font-cal text-lg text-black">
                            {active.mode === "import" ? "Import" : "Export"}: {active.providerId}
                          </h3>

                          {active.mode === "import" ? (
                            <div className="mt-3 grid gap-3">
                              <label className="text-sm text-black">
                                File Upload
                                <input
                                  type="file"
                                  onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                />
                              </label>
                              {siteId ? (
                                <>
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
                                      disabled={!importFile || uploadingFile}
                                      className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      {uploadingFile ? "Uploading..." : "Upload To Media"}
                                    </button>
                                    <p className="text-xs text-black">
                                      Stores file in active media provider (blob/s3/dbblob), then uses that URL.
                                    </p>
                                  </div>
                                  <div className="rounded-md border border-stone-200 bg-white p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <p className="text-sm text-black">Media Manager</p>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            await loadMediaItems();
                                          } catch (err: any) {
                                            setError(err instanceof Error ? err.message : "Failed to load media.");
                                          }
                                        }}
                                        disabled={mediaLoading}
                                        className="rounded-md border border-stone-700 bg-stone-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                      >
                                        {mediaLoading ? "Loading..." : "Load Media"}
                                      </button>
                                    </div>
                                    {mediaItems.length === 0 ? (
                                      <p className="text-xs text-black">
                                        No loaded media yet.
                                      </p>
                                    ) : (
                                      <label className="text-xs text-black">
                                        Choose existing file URL
                                        <select
                                          value={selectedMediaUrl}
                                          onChange={(event) => setSelectedMediaUrl(event.target.value)}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
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
                                </>
                              ) : null}
                              <label className="text-sm text-black">
                                Import URL
                                <input
                                  type="url"
                                  value={importUrl}
                                  onChange={(event) => setImportUrl(event.target.value)}
                                  placeholder="https://example.com/export.json"
                                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                />
                              </label>
                              <label className="text-sm text-black">
                                Import JSON (optional)
                                <textarea
                                  value={importText}
                                  onChange={(event) => setImportText(event.target.value)}
                                  rows={6}
                                  placeholder='{"manifest": {"schemaVersion": "1"}}'
                                  className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
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
                              <div className="grid gap-2 rounded-md border border-stone-300 bg-white p-3">
                                <button
                                  type="button"
                                  onClick={() => setShowCommonExportOptions((value) => !value)}
                                  className="text-left text-sm font-semibold text-black"
                                >
                                  {showCommonExportOptions ? "Hide Common Export Options" : "Show Common Export Options"}
                                </button>
                                {showCommonExportOptions ? (
                                  <>
                                    <label className="text-sm text-black">
                                      Compression
                                      <select
                                        value={exportCompression}
                                        onChange={(event) => setExportCompression(event.target.value as "none" | "gzip")}
                                        className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                      >
                                        <option value="none">None</option>
                                        <option value="gzip">Gzip</option>
                                      </select>
                                    </label>
                                    <label className="inline-flex items-center gap-2 text-sm text-black">
                                      <input
                                        type="checkbox"
                                        checked={exportIncludeChecksums}
                                        onChange={(event) => setExportIncludeChecksums(event.target.checked)}
                                      />
                                      Include checksums
                                    </label>
                                    <label className="inline-flex items-center gap-2 text-sm text-black">
                                      <input
                                        type="checkbox"
                                        checked={exportIncludeSchemaVersion}
                                        onChange={(event) => setExportIncludeSchemaVersion(event.target.checked)}
                                      />
                                      Include schema version
                                    </label>
                                    <label className="text-sm text-black">
                                      Timezone
                                      <select
                                        value={exportTimezone}
                                        onChange={(event) => setExportTimezone(event.target.value as "UTC" | "site-local")}
                                        className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                      >
                                        <option value="UTC">UTC</option>
                                        <option value="site-local">Site Local</option>
                                      </select>
                                    </label>
                                    <label className="text-sm text-black">
                                      Locale (optional)
                                      <input
                                        type="text"
                                        value={exportLocale}
                                        onChange={(event) => setExportLocale(event.target.value)}
                                        placeholder="en-US"
                                        className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                      />
                                    </label>
                                  </>
                                ) : null}
                              </div>

                              {isSnapshotProvider(active.providerId) ? (
                                <div className="grid gap-2 rounded-md border border-stone-300 bg-white p-3">
                                  <button
                                    type="button"
                                    onClick={() => setShowSnapshotExportOptions((value) => !value)}
                                    className="text-left text-sm font-semibold text-black"
                                  >
                                    {showSnapshotExportOptions ? "Hide Snapshot Options" : "Show Snapshot Options"}
                                  </button>
                                  {showSnapshotExportOptions ? (
                                    <>
                                      <label className="text-sm text-black">
                                        Include Users
                                        <select
                                          value={snapshotIncludeUsers}
                                          onChange={(event) => setSnapshotIncludeUsers(event.target.value as "none" | "site-users" | "all-users")}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        >
                                          <option value="none">None</option>
                                          <option value="site-users">Site Users</option>
                                          <option value="all-users">All Users</option>
                                        </select>
                                      </label>
                                      <label className="text-sm text-black">
                                        Include Media
                                        <select
                                          value={snapshotIncludeMedia}
                                          onChange={(event) => setSnapshotIncludeMedia(event.target.value as "references" | "with-manifest" | "with-binaries")}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        >
                                          <option value="references">References Only</option>
                                          <option value="with-manifest">With Manifest</option>
                                          <option value="with-binaries">With Binaries</option>
                                        </select>
                                      </label>
                                      <label className="text-sm text-black">
                                        Include Analytics
                                        <select
                                          value={snapshotIncludeAnalytics}
                                          onChange={(event) => setSnapshotIncludeAnalytics(event.target.value as "none" | "summary" | "full")}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        >
                                          <option value="none">None</option>
                                          <option value="summary">Summary</option>
                                          <option value="full">Full</option>
                                        </select>
                                      </label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeSettings} onChange={(event) => setSnapshotIncludeSettings(event.target.checked)} />Include settings</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeRolesCapabilities} onChange={(event) => setSnapshotIncludeRolesCapabilities(event.target.checked)} />Include roles/capabilities</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeDomains} onChange={(event) => setSnapshotIncludeDomains(event.target.checked)} />Include domains</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeEntries} onChange={(event) => setSnapshotIncludeEntries(event.target.checked)} />Include entries</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeDomainMeta} onChange={(event) => setSnapshotIncludeDomainMeta(event.target.checked)} />Include domain meta</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeTaxonomies} onChange={(event) => setSnapshotIncludeTaxonomies(event.target.checked)} />Include taxonomies</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeTermMeta} onChange={(event) => setSnapshotIncludeTermMeta(event.target.checked)} />Include term meta</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeMenus} onChange={(event) => setSnapshotIncludeMenus(event.target.checked)} />Include menus</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeThemes} onChange={(event) => setSnapshotIncludeThemes(event.target.checked)} />Include themes</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeThemeConfig} onChange={(event) => setSnapshotIncludeThemeConfig(event.target.checked)} />Include theme config</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludePlugins} onChange={(event) => setSnapshotIncludePlugins(event.target.checked)} />Include plugins</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludePluginConfig} onChange={(event) => setSnapshotIncludePluginConfig(event.target.checked)} />Include plugin config</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeSchedules} onChange={(event) => setSnapshotIncludeSchedules(event.target.checked)} />Include schedules</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={snapshotIncludeWebhooks} onChange={(event) => setSnapshotIncludeWebhooks(event.target.checked)} />Include webhooks</label>
                                    </>
                                  ) : null}
                                </div>
                              ) : null}

                              {isArticlesProvider(active.providerId) ? (
                                <div className="grid gap-2 rounded-md border border-stone-300 bg-white p-3">
                                  <button
                                    type="button"
                                    onClick={() => setShowArticlesExportOptions((value) => !value)}
                                    className="text-left text-sm font-semibold text-black"
                                  >
                                    {showArticlesExportOptions ? "Hide Articles Options" : "Show Articles Options"}
                                  </button>
                                  {showArticlesExportOptions ? (
                                    <>
                                      <label className="text-sm text-black">
                                        Domains (CSV)
                                        <input
                                          type="text"
                                          value={articlesDomainsCsv}
                                          onChange={(event) => setArticlesDomainsCsv(event.target.value)}
                                          placeholder="post,page"
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        />
                                      </label>
                                      <label className="text-sm text-black">
                                        Entry States
                                        <select
                                          value={articlesEntryStates}
                                          onChange={(event) => setArticlesEntryStates(event.target.value as "published" | "draft" | "scheduled" | "all")}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        >
                                          <option value="published">Published</option>
                                          <option value="draft">Draft</option>
                                          <option value="scheduled">Scheduled</option>
                                          <option value="all">All</option>
                                        </select>
                                      </label>
                                      <label className="text-sm text-black">
                                        Authors (CSV, optional)
                                        <input
                                          type="text"
                                          value={articlesAuthorsCsv}
                                          onChange={(event) => setArticlesAuthorsCsv(event.target.value)}
                                          placeholder="user1,user2"
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        />
                                      </label>
                                      <label className="text-sm text-black">
                                        Taxonomies
                                        <select
                                          value={articlesTaxonomies}
                                          onChange={(event) => setArticlesTaxonomies(event.target.value as "none" | "attached-only" | "full-definitions")}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        >
                                          <option value="none">None</option>
                                          <option value="attached-only">Attached Only</option>
                                          <option value="full-definitions">Full Definitions</option>
                                        </select>
                                      </label>
                                      <label className="text-sm text-black">
                                        Meta Handling
                                        <select
                                          value={articlesIncludeMeta}
                                          onChange={(event) => setArticlesIncludeMeta(event.target.value as "none" | "selected" | "all")}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        >
                                          <option value="none">None</option>
                                          <option value="selected">Selected Keys</option>
                                          <option value="all">All</option>
                                        </select>
                                      </label>
                                      {articlesIncludeMeta === "selected" ? (
                                        <label className="text-sm text-black">
                                          Meta Keys (CSV)
                                          <input
                                            type="text"
                                            value={articlesMetaKeysCsv}
                                            onChange={(event) => setArticlesMetaKeysCsv(event.target.value)}
                                            placeholder="seo_title,seo_description"
                                            className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                          />
                                        </label>
                                      ) : null}
                                      <label className="text-sm text-black">
                                        Date From (optional)
                                        <input
                                          type="datetime-local"
                                          value={articlesDateFrom}
                                          onChange={(event) => setArticlesDateFrom(event.target.value)}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        />
                                      </label>
                                      <label className="text-sm text-black">
                                        Date To (optional)
                                        <input
                                          type="datetime-local"
                                          value={articlesDateTo}
                                          onChange={(event) => setArticlesDateTo(event.target.value)}
                                          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                        />
                                      </label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={articlesIncludeContent} onChange={(event) => setArticlesIncludeContent(event.target.checked)} />Include content</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={articlesIncludeExcerpt} onChange={(event) => setArticlesIncludeExcerpt(event.target.checked)} />Include excerpt</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={articlesIncludeSeo} onChange={(event) => setArticlesIncludeSeo(event.target.checked)} />Include SEO fields</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={articlesIncludeFeaturedMedia} onChange={(event) => setArticlesIncludeFeaturedMedia(event.target.checked)} />Include featured media</label>
                                      <label className="inline-flex items-center gap-2 text-sm text-black"><input type="checkbox" checked={articlesIncludeMediaManifest} onChange={(event) => setArticlesIncludeMediaManifest(event.target.checked)} />Include media manifest</label>
                                    </>
                                  ) : null}
                                </div>
                              ) : null}

                              {!isSnapshotProvider(active.providerId) && !isArticlesProvider(active.providerId) ? (
                                <p className="text-xs text-black">
                                  Provider-specific options are not declared for this format yet. Use advanced JSON if needed.
                                </p>
                              ) : null}
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setShowAdvancedExportOptions((value) => !value)}
                                  className="rounded-md border border-stone-700 bg-white px-3 py-1 text-xs font-semibold text-black"
                                >
                                  {showAdvancedExportOptions ? "Hide Advanced Options" : "Show Advanced Options"}
                                </button>
                              </div>
                              {showAdvancedExportOptions ? (
                                <div className="grid gap-2 rounded-md border border-stone-300 bg-white p-3">
                                  <label className="text-sm text-black">
                                    Output Format
                                    <select
                                      value={exportOutputFormat}
                                      onChange={(event) => setExportOutputFormat(event.target.value)}
                                      className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                    >
                                      <option value="json">JSON</option>
                                      <option value="ndjson">NDJSON</option>
                                    </select>
                                  </label>
                                  <label className="text-sm text-black">
                                    Advanced Options JSON (optional)
                                    <textarea
                                      value={exportOptionsText}
                                      onChange={(event) => setExportOptionsText(event.target.value)}
                                      rows={6}
                                      className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                    />
                                  </label>
                                </div>
                              ) : null}
                              {exportVerificationRequired ? (
                                <div className="grid gap-2 rounded-md border border-orange-400 bg-orange-50 p-3">
                                  <label className="text-sm text-black">
                                    Verification Code
                                    <input
                                      type="text"
                                      value={exportVerificationCode}
                                      onChange={(event) => setExportVerificationCode(event.target.value)}
                                      placeholder="Enter 6-digit code"
                                      className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                    />
                                  </label>
                                  {exportVerificationHint ? (
                                    <p className="rounded border border-orange-400 bg-orange-200 px-2 py-1 text-xs font-semibold text-orange-900">
                                      {exportVerificationHint}
                                    </p>
                                  ) : null}
                                  {exportVerificationExpiresAt ? (
                                    <p className="text-xs text-orange-900">
                                      Code expires: {new Date(exportVerificationExpiresAt).toLocaleString()}
                                    </p>
                                  ) : null}
                                  <div>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          if (!active) return;
                                          await cancelExportVerification(active.providerId);
                                        } catch (err: any) {
                                          setError(err instanceof Error ? err.message : "Cancel failed.");
                                        }
                                      }}
                                      disabled={Boolean(busy)}
                                      className="rounded-md border border-black bg-white px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
                                    >
                                      Cancel Verification
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              <div className="grid gap-2 rounded-md border border-stone-300 bg-white p-3">
                                <label className="text-sm text-black">
                                  Export Reason
                                  <textarea
                                    value={exportReason}
                                    onChange={(event) => setExportReason(event.target.value)}
                                    rows={3}
                                    placeholder="Why this export is required (audit log)."
                                    className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                  />
                                </label>
                                <p className="text-xs text-black">
                                  Required for audit and alerting.
                                </p>
                              </div>
                              <div className="grid gap-2 rounded-md border border-stone-300 bg-white p-3">
                                <label className="text-sm text-black">
                                  Verification Recipient
                                  <input
                                    type="text"
                                    value={siteId ? "Site administrators" : "Network administrators"}
                                    readOnly
                                    className="mt-1 block w-full rounded-md border border-stone-300 bg-stone-100 px-2 py-1 text-sm text-black"
                                  />
                                </label>
                                <label className="text-sm text-black">
                                  Export Delivery Email (optional)
                                  <input
                                    type="email"
                                    value={exportDeliveryEmail}
                                    onChange={(event) => setExportDeliveryEmail(event.target.value)}
                                    placeholder="you@company.com"
                                    className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                                  />
                                </label>
                                <p className="text-xs text-black">
                                  Verification code is always sent to administrators. This email is only for export delivery/notifications.
                                </p>
                              </div>
                              {(() => {
                                const exportButtonUi = getExportButtonUi(active.providerId);
                                return (
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
                                  className={exportButtonUi.className}
                                >
                                  {exportButtonUi.label}
                                </button>
                              </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null,
              ];
            })}
            {enabledProviders.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-sm text-black">
                  No enabled formats found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {showDryRunPreview && result ? (
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black">
            {report?.title || "Result"}
          </p>
          {report ? (
            <div className="space-y-1 text-sm text-black">
              {report.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {report.warnings.length > 0 ? (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
                  {report.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-black">
              Technical Details
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto text-xs text-black">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
