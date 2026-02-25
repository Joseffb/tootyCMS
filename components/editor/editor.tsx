"use client";

import { defaultEditorContent } from "@/lib/content";
import {
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorContent,
  type EditorInstance,
  EditorRoot,
  ImageResizer,
  type JSONContent,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
} from "novel";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { defaultExtensions } from "./extensions/editor-extensions";
import { createUploadFn } from "@/components/tailwind/image-upload";
import { getSuggestionItems, setCurrentPost, setPluginSuggestionItems, slashCommand } from "@/components/tailwind/slash-command";
import {
  createTaxonomyTerm,
  getAllMetaKeys,
  getTaxonomyOverview,
  getTaxonomyTerms,
  getTaxonomyTermsPreview,
  updateDomainPost,
  updateDomainPostMetadata,
} from "@/lib/actions";
import TextareaAutosize from "react-textarea-autosize";
import { cn } from "@/lib/utils";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ExternalLink,
  Link2,
  Unlink2,
} from "lucide-react";
import { toast } from "sonner";
import LoadingDots from "../icons/loading-dots";
import { getSitePublicUrl } from "@/lib/site-url";
import { createSaveQueue, type SaveQueueStatus } from "@/lib/editor-save-queue";
import { uploadSmart } from "@/lib/uploadSmart";
import { DEFAULT_TOOTY_IMAGE } from "@/lib/tooty-images";

type EditorMode = "html-css-first" | "rich-text";
type SidebarTab = "document" | "block" | "plugins";
type EditorPluginSnippet = {
  id: string;
  title: string;
  description?: string;
  content: string;
};
type EditorPlugin = {
  id: string;
  name: string;
  snippets: EditorPluginSnippet[];
};
type EditorFooterPanel = {
  id: string;
  title: string;
  content: string;
};
type PostMetaEntry = { key: string; value: string };
type MediaItem = {
  id: number;
  url: string;
  objectKey: string;
  label: string | null;
  mimeType: string | null;
  size: number | null;
  provider: string;
  createdAt: string | null;
};

type SidebarMediaItem = {
  id: number | string;
  url: string;
  name: string;
  label: string | null;
  inLibrary: boolean;
  source: "content" | "thumbnail";
};

const extensions = [...defaultExtensions, slashCommand];

type PostWithSite = {
  id: string;
  siteId: string | null;
  title: string | null;
  description: string | null;
  content: string | null;
  layout: string | null;
  slug: string;
  published: boolean;
  image?: string | null;
  site?: { subdomain: string | null } | null;
  categories?: { categoryId: number }[];
  tags?: { tagId: number }[];
  taxonomyAssignments?: Array<{
    taxonomy: string;
    termTaxonomyId: number;
    name: string;
  }>;
  meta?: PostMetaEntry[];
};

type TaxonomyOverviewRow = {
  taxonomy: string;
  label: string;
  termCount: number;
};

type TaxonomyTerm = {
  id: number;
  name: string;
};

type SavePostAction = (data: {
  id: string;
  title?: string | null;
  description?: string | null;
  slug?: string;
  content?: string | null;
  layout?: string | null;
  categoryIds?: number[];
  tagIds?: number[];
  taxonomyIds?: number[];
  metaEntries?: Array<{ key: string; value: string }>;
}) => Promise<any>;

type UpdatePostMetadataAction = (formData: FormData, postId: string, key: string) => Promise<any>;

function parseInitialContent(raw: string | null | undefined): JSONContent {
  if (!raw) return defaultEditorContent as JSONContent;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.type === "doc") return parsed as JSONContent;
  } catch {
    // ignore malformed stored content and fall back
  }
  return defaultEditorContent as JSONContent;
}

function formatSaveLabel(status: SaveQueueStatus, error: string | null) {
  if (status === "saving") return "Saving...";
  if (status === "unsaved") return "Unsaved";
  if (status === "error") return error ? `Error: ${error}` : "Save failed";
  if (status === "saved") return "Saved";
  return "Saved";
}

function getCurrentBlockMode(editor: EditorInstance): string {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("heading", { level: 4 })) return "h4";
  if (editor.isActive("heading", { level: 5 })) return "h5";
  if (editor.isActive("heading", { level: 6 })) return "h6";
  if (editor.isActive("codeBlock")) return "codeBlock";
  if (editor.isActive("taskItem")) return "taskList";
  return "paragraph";
}

function getCurrentTextAlign(editor: EditorInstance): "left" | "center" | "right" {
  const headingAlign = editor.getAttributes("heading")?.textAlign;
  const paragraphAlign = editor.getAttributes("paragraph")?.textAlign;
  const raw = headingAlign || paragraphAlign || "left";
  if (raw === "center" || raw === "right") return raw;
  return "left";
}

function countImageNodes(node: any): number {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countImageNodes(item), 0);
  const self = node.type === "image" ? 1 : 0;
  return self + countImageNodes(node.content);
}

function collectImageUrlsFromNode(node: any): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectImageUrlsFromNode(item));

  const urls: string[] = [];
  if (node.type === "image") {
    const src = typeof node?.attrs?.src === "string" ? node.attrs.src.trim() : "";
    if (src) urls.push(src);
  }
  return urls.concat(collectImageUrlsFromNode(node.content));
}

function fileNameFromUrl(url: string) {
  const withoutQuery = url.split("?")[0] || url;
  const segments = withoutQuery.split("/");
  const last = segments[segments.length - 1] || withoutQuery;
  return decodeURIComponent(last || "file");
}

function normalizeSlugInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function Editor({
  post,
  defaultEditorMode = "rich-text",
  onSave = updateDomainPost,
  onUpdateMetadata = updateDomainPostMetadata,
  enableThumbnail = true,
  canEdit = true,
  canPublish = true,
}: {
  post: PostWithSite;
  defaultEditorMode?: EditorMode;
  onSave?: SavePostAction;
  onUpdateMetadata?: UpdatePostMetadataAction;
  enableThumbnail?: boolean;
  canEdit?: boolean;
  canPublish?: boolean;
}) {
  const [initialContent, setInitialContent] = useState<JSONContent | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveQueueStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [charsCount, setCharsCount] = useState<number>();
  const [taxonomyOverviewRows, setTaxonomyOverviewRows] = useState<TaxonomyOverviewRow[]>([]);
  const [taxonomyTermsByKey, setTaxonomyTermsByKey] = useState<Record<string, TaxonomyTerm[]>>({});
  const [taxonomyExpanded, setTaxonomyExpanded] = useState<Record<string, boolean>>({});
  const [taxonomyLoadingMore, setTaxonomyLoadingMore] = useState<Record<string, boolean>>({});
  const [selectedTermsByTaxonomy, setSelectedTermsByTaxonomy] = useState<Record<string, number[]>>({});
  const [termNameById, setTermNameById] = useState<Record<number, string>>({});
  const [metaEntries, setMetaEntries] = useState<PostMetaEntry[]>([]);
  const [metaKeySuggestions, setMetaKeySuggestions] = useState<string[]>([]);
  const [taxonomyInputByKey, setTaxonomyInputByKey] = useState<Record<string, string>>({});
  const [metaKeyInput, setMetaKeyInput] = useState("");
  const [metaValueInput, setMetaValueInput] = useState("");
  const [currentBlockMode, setCurrentBlockMode] = useState<string>("paragraph");
  const [currentTextAlign, setCurrentTextAlign] = useState<"left" | "center" | "right">("left");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("document");
  const [editorMode, setEditorMode] = useState<EditorMode>(defaultEditorMode);
  const [htmlDraft, setHtmlDraft] = useState<string>("");
  const [editorPlugins, setEditorPlugins] = useState<EditorPlugin[]>([]);
  const [editorFooterPanels, setEditorFooterPanels] = useState<EditorFooterPanel[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [postImageUrls, setPostImageUrls] = useState<string[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const [mediaModalMode, setMediaModalMode] = useState<"insert" | "thumbnail">("insert");
  const [, setToolbarTick] = useState(0);

  const editorRef = useRef<EditorInstance | null>(null);
  const htmlDirtyRef = useRef(false);
  const htmlDraftRef = useRef("");
  const selectedTermsByTaxonomyRef = useRef<Record<string, number[]>>({});
  const metaEntriesRef = useRef<PostMetaEntry[]>([]);
  const dataRef = useRef<PostWithSite>(post);
  const lastQueuedSignatureRef = useRef<string>("");
  const lastSavedSignatureRef = useRef<string>("");
  const lastImageCountRef = useRef<number>(0);

  useEffect(() => {
    dataRef.current = post;
    setCurrentPost(post);
    const content = parseInitialContent(post.content);
    setInitialContent(content);
    setPostImageUrls(Array.from(new Set(collectImageUrlsFromNode(content))));

    const selected: Record<string, number[]> = {};
    const nextTermNameById: Record<number, string> = {};
    if (Array.isArray(post.taxonomyAssignments) && post.taxonomyAssignments.length > 0) {
      for (const assignment of post.taxonomyAssignments) {
        const taxonomy = assignment.taxonomy || "category";
        const list = selected[taxonomy] ?? [];
        if (!list.includes(assignment.termTaxonomyId)) list.push(assignment.termTaxonomyId);
        selected[taxonomy] = list;
        if (assignment.name) {
          nextTermNameById[assignment.termTaxonomyId] = assignment.name;
        }
      }
    } else {
      selected.category = post.categories?.map((c) => c.categoryId) ?? [];
      selected.tag = post.tags?.map((t) => t.tagId) ?? [];
    }
    setSelectedTermsByTaxonomy(selected);
    selectedTermsByTaxonomyRef.current = selected;
    setTermNameById((prev) => ({ ...prev, ...nextTermNameById }));
    const nextMeta = (post.meta ?? []).map((entry) => ({ key: entry.key, value: entry.value }));
    setMetaEntries(nextMeta);
    metaEntriesRef.current = nextMeta;
    lastImageCountRef.current = countImageNodes(content);
  }, [post]);

  const [data, setData] = useState<PostWithSite>(post);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    selectedTermsByTaxonomyRef.current = selectedTermsByTaxonomy;
  }, [selectedTermsByTaxonomy]);
  useEffect(() => {
    metaEntriesRef.current = metaEntries;
  }, [metaEntries]);

  useEffect(() => {
    htmlDraftRef.current = htmlDraft;
  }, [htmlDraft]);

  const getAllSelectedTaxonomyIds = (selected: Record<string, number[]>) =>
    Array.from(
      new Set(
        Object.values(selected)
          .flat()
          .filter((id): id is number => Number.isFinite(id)),
      ),
    );

  useEffect(() => {
    let mounted = true;
    getTaxonomyOverview()
      .then(async (rows) => {
        if (!mounted) return;
        const sorted = [...rows].sort((a, b) => a.taxonomy.localeCompare(b.taxonomy));
        setTaxonomyOverviewRows(sorted);
        await Promise.all(
          sorted.map(async (row) => {
            const preview = await getTaxonomyTermsPreview(row.taxonomy, 20);
            if (!mounted) return;
            setTaxonomyTermsByKey((prev) => ({
              ...prev,
              [row.taxonomy]: preview.map((term) => ({ id: term.id, name: term.name })),
            }));
            setTermNameById((prev) => {
              const next = { ...prev };
              for (const term of preview) {
                next[term.id] = term.name;
              }
              return next;
            });
          }),
        );
      })
      .catch(() => {
        if (!mounted) return;
        setTaxonomyOverviewRows([]);
      });
    getAllMetaKeys().then((keys) => setMetaKeySuggestions(keys));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (post.siteId) params.set("siteId", post.siteId);
    if (post.id) params.set("postId", post.id);
    fetch(`/api/plugins/editor?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { plugins: [] }))
      .then((json) => {
        const plugins = Array.isArray(json.plugins) ? json.plugins : [];
        setEditorPlugins(plugins);
        const footerPanels = Array.isArray(json.footerPanels) ? json.footerPanels : [];
        setEditorFooterPanels(
          footerPanels
            .map((panel: any) => ({
              id: String(panel?.id || ""),
              title: String(panel?.title || ""),
              content: String(panel?.content || ""),
            }))
            .filter((panel: EditorFooterPanel) => panel.id && panel.content),
        );
        const pluginSlashItems = plugins.flatMap((plugin: any) =>
          (plugin.snippets || []).map((snippet: any) => ({
            pluginId: plugin.id,
            pluginName: plugin.name,
            id: snippet.id,
            title: snippet.title,
            description: snippet.description,
            content: snippet.content,
          })),
        );
        setPluginSuggestionItems(pluginSlashItems);
      })
      .catch(() => {
        setEditorPlugins([]);
        setEditorFooterPanels([]);
        setPluginSuggestionItems([]);
      });
  }, [post.siteId, post.id]);

  useEffect(() => {
    if (!post.siteId) {
      setMediaItems([]);
      return;
    }
    setMediaLoading(true);
    fetch(`/api/media?siteId=${encodeURIComponent(post.siteId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((json) => {
        setMediaItems(Array.isArray(json?.items) ? json.items : []);
      })
      .catch(() => setMediaItems([]))
      .finally(() => setMediaLoading(false));
  }, [post.siteId]);

  const uploadFn = createUploadFn(post.siteId || "default", "post");
  const [isPendingPublishing, startTransitionPublishing] = useTransition();
  const [isPendingThumbnail, startTransitionThumbnail] = useTransition();

  const sidebarMediaItems = useMemo<SidebarMediaItem[]>(() => {
    const byUrl = new Map<string, MediaItem>();
    for (const item of mediaItems) {
      byUrl.set(item.url, item);
    }

    const contentUrls = Array.from(new Set(postImageUrls.filter(Boolean)));
    const thumbnailUrl = typeof data.image === "string" ? data.image.trim() : "";
    const rows: SidebarMediaItem[] = [];
    const seen = new Set<string>();

    for (const url of contentUrls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const match = byUrl.get(url);
      rows.push({
        id: match?.id ?? `content-${url}`,
        url,
        name: match?.label || fileNameFromUrl(match?.objectKey || url),
        label: match?.label ?? null,
        inLibrary: Boolean(match),
        source: "content",
      });
    }

    if (thumbnailUrl && !seen.has(thumbnailUrl)) {
      const match = byUrl.get(thumbnailUrl);
      rows.unshift({
        id: match?.id ?? `thumbnail-${thumbnailUrl}`,
        url: thumbnailUrl,
        name: match?.label || fileNameFromUrl(match?.objectKey || thumbnailUrl),
        label: match?.label ?? null,
        inLibrary: Boolean(match),
        source: "thumbnail",
      });
    }

    return rows;
  }, [mediaItems, postImageUrls, data.image]);

  const saveQueue = useMemo(
    () =>
      createSaveQueue<{
        id: string;
        title: string;
        description: string;
        slug: string;
        content: string;
        layout: string | null;
        categoryIds: number[];
        tagIds: number[];
        taxonomyIds: number[];
        metaEntries: PostMetaEntry[];
        signature: string;
      }>({
        debounceMs: 600,
        save: async (payload) => {
          const result = await onSave(payload);
          if ((result as any)?.error) {
            throw new Error(String((result as any).error));
          }
          lastSavedSignatureRef.current = payload.signature;
        },
        onStatus: ({ status, error }) => {
          setSaveStatus(status);
          setSaveError(error instanceof Error ? error.message : error ? String(error) : null);
        },
      }),
    [onSave],
  );

  useEffect(() => {
    return () => {
      saveQueue.dispose();
    };
  }, [saveQueue]);

  useEffect(() => {
    const flushOnLeave = () => {
      void saveQueue.flush();
    };
    window.addEventListener("beforeunload", flushOnLeave);
    window.addEventListener("pagehide", flushOnLeave);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void saveQueue.flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushOnLeave);
      window.removeEventListener("pagehide", flushOnLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [saveQueue]);

  const getContentJSON = () => {
    const editor = editorRef.current;
    if (!editor) return parseInitialContent(dataRef.current.content);

    if (editorMode === "html-css-first" && htmlDirtyRef.current) {
      editor.commands.setContent(htmlDraftRef.current || "", false);
      htmlDirtyRef.current = false;
    }

    return editor.getJSON();
  };

  const enqueueSave = (immediate = false) => {
    if (!canEdit) return;
    const json = getContentJSON();
    const latest = dataRef.current;
    const content = JSON.stringify(json);
    const signature = JSON.stringify({
      id: latest.id,
      title: latest.title ?? "",
      description: latest.description ?? "",
      slug: latest.slug ?? "",
      content,
      layout: latest.layout ?? null,
      categoryIds: selectedTermsByTaxonomyRef.current.category ?? [],
      tagIds: selectedTermsByTaxonomyRef.current.tag ?? [],
      taxonomyIds: getAllSelectedTaxonomyIds(selectedTermsByTaxonomyRef.current),
      metaEntries: metaEntriesRef.current,
    });

    if (!immediate && signature === lastQueuedSignatureRef.current) return;
    if (!immediate && signature === lastSavedSignatureRef.current) return;
    lastQueuedSignatureRef.current = signature;

    saveQueue.enqueue(
      {
        id: latest.id,
        title: latest.title ?? "",
        description: latest.description ?? "",
        slug: latest.slug ?? "",
        content,
        layout: latest.layout ?? null,
        categoryIds: selectedTermsByTaxonomyRef.current.category ?? [],
        tagIds: selectedTermsByTaxonomyRef.current.tag ?? [],
        taxonomyIds: getAllSelectedTaxonomyIds(selectedTermsByTaxonomyRef.current),
        metaEntries: metaEntriesRef.current,
        signature,
      },
      { immediate },
    );
  };

  const saveNow = async () => {
    if (!canEdit) return;
    const json = getContentJSON();
    const latest = dataRef.current;
    const content = JSON.stringify(json);
    const signature = JSON.stringify({
      id: latest.id,
      title: latest.title ?? "",
      description: latest.description ?? "",
      slug: latest.slug ?? "",
      content,
      layout: latest.layout ?? null,
      categoryIds: selectedTermsByTaxonomyRef.current.category ?? [],
      tagIds: selectedTermsByTaxonomyRef.current.tag ?? [],
      taxonomyIds: getAllSelectedTaxonomyIds(selectedTermsByTaxonomyRef.current),
      metaEntries: metaEntriesRef.current,
    });

    setSaveStatus("saving");
    setSaveError(null);
    try {
      const result = await onSave({
        id: latest.id,
        title: latest.title ?? "",
        description: latest.description ?? "",
        slug: latest.slug ?? "",
        content,
        layout: latest.layout ?? null,
        categoryIds: selectedTermsByTaxonomyRef.current.category ?? [],
        tagIds: selectedTermsByTaxonomyRef.current.tag ?? [],
        taxonomyIds: getAllSelectedTaxonomyIds(selectedTermsByTaxonomyRef.current),
        metaEntries: metaEntriesRef.current,
      });
      if ((result as any)?.error) {
        throw new Error(String((result as any).error));
      }
      lastQueuedSignatureRef.current = signature;
      lastSavedSignatureRef.current = signature;
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const exec = (fn: (editor: EditorInstance) => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    fn(editor);
    editor.commands.focus();
  };

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    const editor = editorRef.current;
    if (!editor) return false;
    return editor.isActive(name as any, attrs as any);
  };

  const getTermsForTaxonomy = (taxonomy: string) => taxonomyTermsByKey[taxonomy] ?? [];

  const updateSelectedTermsByTaxonomy = (
    updater:
      | Record<string, number[]>
      | ((prev: Record<string, number[]>) => Record<string, number[]>),
    saveImmediately = false,
  ) => {
    const prev = selectedTermsByTaxonomyRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    selectedTermsByTaxonomyRef.current = next;
    setSelectedTermsByTaxonomy(next);
    if (saveImmediately) {
      enqueueSave(true);
    }
  };

  const toggleTaxonomyTerm = (taxonomy: string, termId: number) => {
    if (!canEdit) return;
    updateSelectedTermsByTaxonomy((prev) => {
      const current = prev[taxonomy] ?? [];
      const next = current.includes(termId)
        ? current.filter((id) => id !== termId)
        : [...current, termId];
      return { ...prev, [taxonomy]: next };
    }, true);
  };

  const loadAllTermsForTaxonomy = async (taxonomy: string) => {
    if (taxonomyExpanded[taxonomy]) return;
    setTaxonomyLoadingMore((prev) => ({ ...prev, [taxonomy]: true }));
    try {
      const rows = await getTaxonomyTerms(taxonomy);
      const normalized = rows.map((term) => ({ id: term.id, name: term.name }));
      setTaxonomyTermsByKey((prev) => ({ ...prev, [taxonomy]: normalized }));
      setTermNameById((prev) => {
        const next = { ...prev };
        for (const term of normalized) next[term.id] = term.name;
        return next;
      });
      setTaxonomyExpanded((prev) => ({ ...prev, [taxonomy]: true }));
    } finally {
      setTaxonomyLoadingMore((prev) => ({ ...prev, [taxonomy]: false }));
    }
  };

  const addOrSelectTaxonomyTerm = async (taxonomy: string, rawName: string) => {
    if (!canEdit) return;
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const existing = getTermsForTaxonomy(taxonomy).find(
      (term) => term.name.toLowerCase() === trimmed.toLowerCase(),
    );
    let termId: number | null = existing?.id ?? null;
    if (termId === null) {
      const created = await createTaxonomyTerm({ taxonomy, label: trimmed });
      if ((created as any)?.error) {
        toast.error(String((created as any)?.error));
        return;
      }
      const createdTermId = Number((created as any)?.id);
      const termName = String((created as any)?.name ?? trimmed);
      if (Number.isFinite(createdTermId)) {
        const resolvedTermId = createdTermId;
        termId = resolvedTermId;
        setTaxonomyTermsByKey((prev) => {
          const current = prev[taxonomy] ?? [];
          if (current.some((term) => term.id === resolvedTermId)) return prev;
          const next = [...current, { id: resolvedTermId, name: termName }].sort((a, b) => a.name.localeCompare(b.name));
          return { ...prev, [taxonomy]: next };
        });
        setTermNameById((prev) => ({ ...prev, [resolvedTermId]: termName }));
      }
    }
    if (termId === null) return;
    const selectedTermId = termId;
    updateSelectedTermsByTaxonomy((prev) => {
      const current = prev[taxonomy] ?? [];
      if (current.includes(selectedTermId)) return prev;
      return { ...prev, [taxonomy]: [...current, selectedTermId] };
    }, true);
    setTaxonomyInputByKey((prev) => ({ ...prev, [taxonomy]: "" }));
  };

  const addMetaEntry = (key: string, value: string) => {
    if (!canEdit) return;
    const nextKey = key.trim();
    if (!nextKey) return;
    const nextValue = value.trim();
    setMetaEntries((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.key.toLowerCase() === nextKey.toLowerCase());
      if (existingIndex >= 0) {
        const copy = [...prev];
        copy[existingIndex] = { key: nextKey, value: nextValue };
        return copy;
      }
      return [...prev, { key: nextKey, value: nextValue }];
    });
    setMetaKeySuggestions((prev) => (prev.includes(nextKey) ? prev : [...prev, nextKey].sort((a, b) => a.localeCompare(b))));
    setMetaKeyInput("");
    setMetaValueInput("");
    enqueueSave(true);
  };

  useEffect(() => {
    if (!canEdit) return;
    if (!data?.id) return;
    enqueueSave(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.title, data.description, data.slug, data.layout, selectedTermsByTaxonomy, metaEntries]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const isCmdS = isMac ? e.metaKey && e.key.toLowerCase() === "s" : e.ctrlKey && e.key.toLowerCase() === "s";

      if (isCmdS) {
        if (!canEdit) return;
        e.preventDefault();
        void saveNow();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, canEdit]);

  const url = `${getSitePublicUrl({
    subdomain: data.site?.subdomain,
    customDomain: null,
    isPrimary: data.site?.subdomain === "main",
  }).replace(/\/$/, "")}/${data.slug}`;

  const handleThumbnailUpload = (file: File | null) => {
    if (!canEdit) return;
    if (!file) return;
    if (!post.siteId) {
      toast.error("Site not found for this post.");
      return;
    }
    if (file.size / 1024 / 1024 > 50) {
      toast.error("File size too big (max 50MB).");
      return;
    }
    if (!file.type.includes("png") && !file.type.includes("jpg") && !file.type.includes("jpeg")) {
      toast.error("Invalid file type (must be .png, .jpg, or .jpeg).");
      return;
    }

    startTransitionThumbnail(async () => {
      try {
        const uploaded = await uploadSmart({ file, siteId: post.siteId!, name: "image" });
        const formData = new FormData();
        formData.append("imageUrl", uploaded.url);
        formData.append("imageFinalName", uploaded.url);
        const response = await onUpdateMetadata(formData, post.id, "image");
        if ((response as any)?.error) {
          throw new Error(String((response as any).error));
        }
        setData((prev) => ({ ...prev, image: uploaded.url }));
        toast.success("Thumbnail updated.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update thumbnail.");
      }
    });
  };

  const setThumbnailFromMediaItem = (item: MediaItem) => {
    if (!canEdit) return;
    startTransitionThumbnail(async () => {
      try {
        const formData = new FormData();
        formData.append("imageUrl", item.url);
        formData.append("imageFinalName", item.url);
        const response = await onUpdateMetadata(formData, post.id, "image");
        if ((response as any)?.error) {
          throw new Error(String((response as any).error));
        }
        setData((prev) => ({ ...prev, image: item.url }));
        toast.success("Thumbnail updated from media manager.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to set thumbnail.");
      }
    });
  };

  if (!initialContent) return null;

  return (
    <div className="grid w-full max-w-[1400px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {data.published && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-sm text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {canEdit ? (
              <div className="rounded-lg bg-accent px-2 py-1 text-sm text-muted-foreground">
                {formatSaveLabel(saveStatus, saveError)}
              </div>
            ) : null}
            <div className={charsCount ? "rounded-lg bg-accent px-2 py-1 text-sm text-muted-foreground" : "hidden"}>
              {charsCount} Words
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                editorMode === "rich-text" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-stone-700",
              )}
              onClick={() => {
                setEditorMode("rich-text");
                const editor = editorRef.current;
                if (editor) {
                  setHtmlDraft(editor.getHTML());
                  htmlDirtyRef.current = false;
                }
              }}
            >
              Visual
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                editorMode === "html-css-first" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-stone-700",
              )}
              onClick={() => {
                const editor = editorRef.current;
                if (editor) {
                  setHtmlDraft(editor.getHTML());
                }
                setEditorMode("html-css-first");
              }}
            >
              HTML
            </button>

            <button
              onClick={() => {
                if (!canPublish) return;
                const formData = new FormData();
                formData.append("published", String(!data.published));
                startTransitionPublishing(async () => {
                  try {
                    const response = await onUpdateMetadata(formData, post.id, "published");
                    if ((response as any)?.error) {
                      throw new Error(String((response as any).error));
                    }
                    toast.success(`Successfully ${data.published ? "unpublished" : "published"} your post.`);
                    setData((prev) => ({ ...prev, published: !prev.published }));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to update publish status.");
                  }
                });
              }}
              className={cn(
                "flex h-7 w-24 items-center justify-center space-x-2 rounded-lg border text-sm transition-all focus:outline-none",
                isPendingPublishing || !canPublish
                  ? "cursor-not-allowed border-muted bg-muted text-muted-foreground"
                  : "border border-black bg-white text-black hover:bg-gray-800 hover:text-white active:bg-muted dark:border-stone-700",
              )}
              disabled={isPendingPublishing || !canPublish}
            >
              {isPendingPublishing ? <LoadingDots /> : <p>{data.published ? "Unpublish" : "Publish"}</p>}
            </button>
          </div>
        </div>

        <div className="mb-5 flex flex-col space-y-3 border-b border-muted pb-5">
          <input
            type="text"
            placeholder="Title"
            value={data.title ?? ""}
            autoFocus
            onChange={(e) => setData({ ...data, title: e.target.value })}
            readOnly={!canEdit}
            className="border-none bg-background px-0 font-cal text-3xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
          />
          <TextareaAutosize
            placeholder="Description"
            value={data.description ?? ""}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            readOnly={!canEdit}
            className="w-full resize-none border-none bg-background px-0 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
          />
          <div className="max-w-xl">
            <label htmlFor="post-slug" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              Slug
            </label>
            <div className="flex items-center rounded-md border border-stone-300 bg-white px-2">
              <span className="text-sm text-stone-500">/</span>
              <input
                id="post-slug"
                type="text"
                value={data.slug ?? ""}
                onChange={(e) => setData({ ...data, slug: normalizeSlugInput(e.target.value) })}
                placeholder="post-slug"
                readOnly={!canEdit}
                className="w-full border-none bg-transparent px-2 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-0 dark:text-white"
              />
            </div>
          </div>
        </div>

        <EditorRoot>
          <div
            className={cn(
              "relative w-full max-w-screen-lg overflow-hidden border-muted bg-background sm:mb-8 sm:rounded-lg sm:border sm:shadow-lg",
              editorMode === "html-css-first" ? "hidden" : "block",
            )}
          >
            <div className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-3 py-2 backdrop-blur">
              <p className="mt-2 text-xs text-stone-500">
                Tip: type <code>/</code> for quick commands (headings, lists, embeds, images).
              </p>
            </div>

            <EditorContent
              initialContent={initialContent}
              extensions={extensions}
              className="min-h-[900px] w-full bg-background"
              editorProps={{
                handleDOMEvents: {
                  keydown: (_view, event) => handleCommandNavigation(event),
                },
                handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
                handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
                attributes: {
                  class:
                    "prose prose-lg max-w-full px-6 py-5 font-default text-black focus:outline-none prose-h1:text-black prose-h2:text-black prose-h3:text-black prose-headings:text-black prose-strong:text-black dark:prose-invert",
                },
              }}
              onUpdate={({ editor }) => {
                editorRef.current = editor;
                setCharsCount(editor.storage.characterCount.words());
                setCurrentBlockMode(getCurrentBlockMode(editor));
                setCurrentTextAlign(getCurrentTextAlign(editor));
                setToolbarTick((v) => v + 1);
                const json = editor.getJSON();
                const imageUrls = Array.from(new Set(collectImageUrlsFromNode(json)));
                setPostImageUrls(imageUrls);
                const imageCount = countImageNodes(json);
                const imageCountChanged = imageCount !== lastImageCountRef.current;
                lastImageCountRef.current = imageCount;
                if (canEdit) enqueueSave(imageCountChanged);
              }}
              onCreate={({ editor }) => {
                editorRef.current = editor;
                editor.setEditable(canEdit);
                setCharsCount(editor.storage.characterCount.words());
                setCurrentBlockMode(getCurrentBlockMode(editor));
                setCurrentTextAlign(getCurrentTextAlign(editor));
                setHtmlDraft(editor.getHTML());
              }}
              onSelectionUpdate={({ editor }) => {
                setCurrentBlockMode(getCurrentBlockMode(editor));
                setCurrentTextAlign(getCurrentTextAlign(editor));
                setToolbarTick((v) => v + 1);
              }}
              slotAfter={<ImageResizer />}
            >
              <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-muted bg-background px-1 py-2 shadow-md bg-white ">
                <EditorCommandEmpty className="px-2 text-muted-foreground">No results</EditorCommandEmpty>
                <EditorCommandList>
                  {getSuggestionItems().map((item: any) => (
                    <EditorCommandItem
                      value={item.title}
                      onCommand={(val) => item.command(val)}
                      className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent"
                      key={item.title}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                        {item.icon}
                      </div>
                      <div>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </div>
                    </EditorCommandItem>
                  ))}
                </EditorCommandList>
              </EditorCommand>
            </EditorContent>
          </div>
        </EditorRoot>

        {editorFooterPanels.length > 0 && (
          <div className="mb-3 space-y-2 rounded-md border border-stone-200 bg-stone-50 p-3">
            {editorFooterPanels.map((panel) => (
              <div key={panel.id} className="rounded border border-stone-200 bg-white px-3 py-2">
                {panel.title ? (
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">{panel.title}</div>
                ) : null}
                <p className="text-sm text-stone-700">{panel.content}</p>
              </div>
            ))}
          </div>
        )}

        {editorMode === "rich-text" && canEdit && (
          <div className="mt-2 flex justify-start">
            <button
              type="button"
              onClick={() => void saveNow()}
              disabled={saveStatus === "saving"}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                saveStatus === "saving"
                  ? "cursor-not-allowed bg-stone-300 text-stone-600"
                  : "bg-black text-white hover:bg-stone-800",
              )}
            >
              {saveStatus === "saving" ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}

        {editorMode === "html-css-first" && (
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">HTML Mode</div>
            <textarea
              value={htmlDraft}
              onChange={(e) => {
                if (!canEdit) return;
                setHtmlDraft(e.target.value);
                htmlDirtyRef.current = true;
                setSaveStatus("unsaved");
              }}
              readOnly={!canEdit}
              className="min-h-[500px] w-full rounded-md border border-stone-300 bg-stone-50 px-4 py-3 font-mono text-sm leading-6 text-stone-900 focus:border-stone-500 focus:outline-none"
              spellCheck={false}
            />
            <div className="mt-2 flex justify-start gap-2">
              {canEdit && (
              <button
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  saveStatus === "saving"
                    ? "cursor-not-allowed bg-stone-300 text-stone-600"
                    : "bg-black text-white hover:bg-stone-800",
                )}
                onClick={() => void saveNow()}
                disabled={saveStatus === "saving"}
              >
                {saveStatus === "saving" ? "Saving..." : "Save Changes"}
              </button>
              )}
              {canEdit && (
              <button
                type="button"
                className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                onClick={() => {
                  const editor = editorRef.current;
                  if (!editor) return;
                  editor.commands.setContent(htmlDraft, false);
                  htmlDirtyRef.current = false;
                  enqueueSave(true);
                  toast.success("HTML applied to editor content.");
                }}
              >
                Apply HTML
              </button>
              )}
            </div>
          </div>
        )}
      </div>

      <aside className={cn("h-fit rounded-xl border border-stone-200 bg-white p-4 shadow-sm", !canEdit && "opacity-75")}>
        {!canEdit && <p className="mb-3 text-xs text-stone-500">Read-only: you can view content but cannot modify this post.</p>}
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Text</div>
        <select
          value={currentBlockMode}
          disabled={!canEdit}
          className="mt-2 w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-sm"
          onChange={(e) => {
            const value = e.target.value;
            setCurrentBlockMode(value);
            exec((editor) => {
              switch (value) {
                case "h1":
                  editor.chain().toggleHeading({ level: 1 }).run();
                  break;
                case "h2":
                  editor.chain().toggleHeading({ level: 2 }).run();
                  break;
                case "h3":
                  editor.chain().toggleHeading({ level: 3 }).run();
                  break;
                case "h4":
                  editor.chain().toggleHeading({ level: 4 }).run();
                  break;
                case "h5":
                  editor.chain().toggleHeading({ level: 5 }).run();
                  break;
                case "h6":
                  editor.chain().toggleHeading({ level: 6 }).run();
                  break;
                default:
                  editor.chain().setParagraph().run();
              }
            });
          }}
        >
          <option value="paragraph">Body</option>
          <option value="h1">Title (H1)</option>
          <option value="h2">Subtitle (H2)</option>
          <option value="h3">Heading (H3)</option>
          <option value="h4">Subheading (H4)</option>
          <option value="h5">Minor Heading (H5)</option>
          <option value="h6">Micro Heading (H6)</option>
        </select>

        <div className="mt-4 grid grid-cols-3 rounded-md border border-stone-200 bg-stone-50 p-1 text-xs">
          <button type="button" onClick={() => setSidebarTab("document")} className={cn("rounded px-2 py-1.5", sidebarTab === "document" ? "bg-stone-900 text-white" : "text-stone-600")}>Style</button>
          <button type="button" onClick={() => setSidebarTab("block")} className={cn("rounded px-2 py-1.5", sidebarTab === "block" ? "bg-stone-900 text-white" : "text-stone-600")}>Layout</button>
          <button type="button" onClick={() => setSidebarTab("plugins")} className={cn("rounded px-2 py-1.5", sidebarTab === "plugins" ? "bg-stone-900 text-white" : "text-stone-600")}>More</button>
        </div>

        {sidebarTab === "document" && (
          <fieldset disabled={!canEdit} className="mt-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Font</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("bold") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleBold().run())}><strong>B</strong></button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("italic") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleItalic().run())}><em>I</em></button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("underline") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleUnderline().run())}><u>U</u></button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("strike") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleStrike().run())}><span className="line-through">S</span></button>
              <button
                type="button"
                title="Align Left"
                aria-label="Align Left"
                aria-pressed={currentTextAlign === "left"}
                className={cn("inline-flex items-center rounded border px-2 py-1 text-xs", currentTextAlign === "left" ? "bg-stone-900 text-white" : "hover:bg-stone-100")}
                onClick={() => exec((e) => e.chain().setTextAlign("left").run())}
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Align Center"
                aria-label="Align Center"
                aria-pressed={currentTextAlign === "center"}
                className={cn("inline-flex items-center rounded border px-2 py-1 text-xs", currentTextAlign === "center" ? "bg-stone-900 text-white" : "hover:bg-stone-100")}
                onClick={() => exec((e) => e.chain().setTextAlign("center").run())}
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Align Right"
                aria-label="Align Right"
                aria-pressed={currentTextAlign === "right"}
                className={cn("inline-flex items-center rounded border px-2 py-1 text-xs", currentTextAlign === "right" ? "bg-stone-900 text-white" : "hover:bg-stone-100")}
                onClick={() => exec((e) => e.chain().setTextAlign("right").run())}
              >
                <AlignRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                title="Add Link"
                aria-label="Add Link"
                className={cn("inline-flex items-center rounded border px-2 py-1 text-xs", isActive("link") ? "bg-stone-900 text-white" : "hover:bg-stone-100")}
                onClick={() => {
                  const href = window.prompt("Enter URL");
                  if (!href) return;
                  exec((e) => e.chain().setLink({ href }).run());
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Remove Link"
                aria-label="Remove Link"
                className="inline-flex items-center rounded border px-2 py-1 text-xs hover:bg-stone-100"
                onClick={() => exec((e) => e.chain().unsetLink().run())}
              >
                <Unlink2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </fieldset>
        )}

        {sidebarTab === "block" && (
          <fieldset disabled={!canEdit} className="mt-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Post Settings</div>
            <select
              value={data.layout ?? "post"}
              onChange={(e) => setData({ ...data, layout: e.target.value })}
              className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900"
            >
              <option value="post">Post Layout (default)</option>
              <option value="page">Page Layout</option>
              <option value="gallery">Gallery Layout (media grid)</option>
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("bulletList") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleBulletList().run())}>Bulleted</button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("orderedList") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleOrderedList().run())}>Numbered</button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("blockquote") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleBlockquote().run())}>Quote</button>
            </div>
          </fieldset>
        )}

        {sidebarTab === "plugins" && (
          <fieldset disabled={!canEdit} className="mt-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Organize</div>
            {taxonomyOverviewRows.map((taxonomyRow) => {
              const taxonomy = taxonomyRow.taxonomy;
              const sectionTerms = getTermsForTaxonomy(taxonomy);
              const selectedTermIds = selectedTermsByTaxonomy[taxonomy] ?? [];
              const hiddenCount = Math.max(0, taxonomyRow.termCount - sectionTerms.length);
              const inputValue = taxonomyInputByKey[taxonomy] ?? "";
              const listId = `editor-taxonomy-${taxonomy}-suggestions`;
              return (
                <div key={`taxonomy-${taxonomy}`} className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">
                    {taxonomyRow.label}
                  </div>
                  <div className="flex gap-1">
                    <input
                      list={listId}
                      value={inputValue}
                      onChange={(e) => setTaxonomyInputByKey((prev) => ({ ...prev, [taxonomy]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addOrSelectTaxonomyTerm(taxonomy, inputValue);
                        }
                      }}
                      placeholder="Type to search or add"
                      className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100"
                      onClick={() => void addOrSelectTaxonomyTerm(taxonomy, inputValue)}
                    >
                      Select
                    </button>
                  </div>
                  <datalist id={listId}>
                    {sectionTerms.map((term) => (
                      <option key={`term-opt-${taxonomy}-${term.id}`} value={term.name} />
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-1">
                    {sectionTerms.map((term) => {
                      const isSelected = selectedTermIds.includes(term.id);
                      return (
                        <button
                          key={`term-${taxonomy}-${term.id}`}
                          type="button"
                          onClick={() => toggleTaxonomyTerm(taxonomy, term.id)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                            isSelected ? "border-black bg-black text-white" : "border-stone-300 bg-white hover:bg-stone-100",
                          )}
                        >
                          {term.name}
                        </button>
                      );
                    })}
                  </div>
                  {!taxonomyExpanded[taxonomy] && hiddenCount > 0 && (
                    <button
                      type="button"
                      className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] hover:bg-stone-100"
                      onClick={() => void loadAllTermsForTaxonomy(taxonomy)}
                      disabled={Boolean(taxonomyLoadingMore[taxonomy])}
                    >
                      {taxonomyLoadingMore[taxonomy] ? "Loading..." : `More (${hiddenCount})`}
                    </button>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {selectedTermIds.map((id) => {
                      const label = termNameById[id];
                      if (!label) return null;
                      return (
                        <button
                          key={`selected-${taxonomy}-${id}`}
                          type="button"
                          onClick={() => toggleTaxonomyTerm(taxonomy, id)}
                          className="rounded-full border border-stone-300 bg-white px-2 py-0.5 text-[11px] hover:bg-stone-100"
                          title={`Remove ${label}`}
                        >
                          {label} ×
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Meta Fields</div>
              <div className="flex gap-1">
                <input
                  list="editor-meta-key-suggestions"
                  value={metaKeyInput}
                  onChange={(e) => setMetaKeyInput(e.target.value)}
                  placeholder="Meta key"
                  className="w-1/2 rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                />
                <input
                  value={metaValueInput}
                  onChange={(e) => setMetaValueInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addMetaEntry(metaKeyInput, metaValueInput);
                    }
                  }}
                  placeholder="Meta value"
                  className="w-1/2 rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                />
              </div>
              <button
                type="button"
                className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100"
                onClick={() => addMetaEntry(metaKeyInput, metaValueInput)}
              >
                Add / Update Meta
              </button>
              <datalist id="editor-meta-key-suggestions">
                {metaKeySuggestions.map((keyName) => (
                  <option key={`meta-opt-${keyName}`} value={keyName} />
                ))}
              </datalist>
              <div className="space-y-1">
                {metaEntries.map((entry) => (
                  <div key={`meta-${entry.key}`} className="flex items-center justify-between rounded border border-stone-200 bg-white px-2 py-1 text-[11px]">
                    <div className="truncate">
                      <span className="font-semibold">{entry.key}</span>
                      <span className="text-stone-500"> = {entry.value}</span>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-stone-300 px-1.5 py-0.5 text-[10px] hover:bg-stone-100"
                      onClick={() => setMetaEntries((prev) => prev.filter((item) => item.key !== entry.key))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Extensions</div>
            <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Media Library</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[10px] hover:bg-stone-100"
                    onClick={() => {
                      if (!post.siteId) return;
                      setMediaLoading(true);
                      fetch(`/api/media?siteId=${encodeURIComponent(post.siteId)}`, { cache: "no-store" })
                        .then((res) => (res.ok ? res.json() : { items: [] }))
                        .then((json) => setMediaItems(Array.isArray(json?.items) ? json.items : []))
                        .finally(() => setMediaLoading(false));
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[10px] hover:bg-stone-100"
                    onClick={() => {
                      setMediaModalMode("insert");
                      setMediaModalOpen(true);
                    }}
                  >
                    Open Media
                  </button>
                </div>
              </div>
              {mediaLoading ? (
                <p className="text-xs text-stone-600">Loading media...</p>
              ) : sidebarMediaItems.length === 0 ? (
                <p className="text-xs text-stone-600">No media attached to this post yet.</p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-auto pr-1">
                  {sidebarMediaItems.slice(0, 40).map((item) => (
                    <button
                      key={`media-${item.id}-${item.source}`}
                      type="button"
                      className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-left text-[11px] hover:bg-stone-100"
                      title={item.url}
                      onClick={() => {
                        const editor = editorRef.current;
                        if (!editor) return;
                        editor
                          .chain()
                          .focus()
                          .setImage({ src: item.url, alt: item.label || "Site media image" })
                          .run();
                        enqueueSave(true);
                        toast.success("Inserted media from post files.");
                      }}
                    >
                      <div className="truncate font-semibold">
                        {item.source === "thumbnail" ? "Thumbnail: " : ""}
                        {item.name}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {editorPlugins.length === 0 ? (
              <p className="text-xs text-stone-600">No enabled plugin tools. Use <code>/</code> for built-in inserts.</p>
            ) : (
              editorPlugins.map((plugin) => (
                <div key={plugin.id} className="rounded-md border border-stone-200 bg-stone-50 p-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">{plugin.name}</div>
                  <div className="mt-2 space-y-2">
                    {plugin.snippets.map((snippet) => (
                      <button
                        key={snippet.id}
                        type="button"
                        className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-left text-xs text-stone-800 hover:bg-stone-100"
                        onClick={() => {
                          const editor = editorRef.current;
                          if (!editor) return;
                          editor.chain().focus().insertContent(snippet.content).run();
                          enqueueSave(true);
                        }}
                      >
                        <div className="font-semibold">{snippet.title}</div>
                        {snippet.description && <div className="mt-0.5 text-[11px] text-stone-600">{snippet.description}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}

            {enableThumbnail && (
              <div className="pt-2">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Thumbnail</div>
              <div className="mt-2 space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
                <div className="aspect-video w-full overflow-hidden rounded border border-stone-200 bg-white">
                  <img src={data.image || DEFAULT_TOOTY_IMAGE} alt="Post thumbnail" className="h-full w-full object-cover" />
                </div>
                <label className="flex cursor-pointer items-center justify-center rounded border border-stone-300 bg-white px-2 py-1.5 text-xs hover:bg-stone-100">
                  {isPendingThumbnail ? "Uploading..." : "Upload Thumbnail"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    disabled={isPendingThumbnail}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      handleThumbnailUpload(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={isPendingThumbnail}
                  className={cn(
                    "w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-xs hover:bg-stone-100",
                    isPendingThumbnail ? "cursor-not-allowed opacity-60" : "",
                  )}
                  onClick={() => {
                    setMediaModalMode("thumbnail");
                    setMediaModalOpen(true);
                  }}
                >
                  Choose from Media Manager
                </button>
              </div>
            </div>
            )}
          </fieldset>
        )}
      </aside>

      {mediaModalOpen && (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-stone-900/60 p-4">
          <div className="w-full max-w-5xl rounded-xl border border-stone-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-stone-700">Media Library</h3>
              <button
                type="button"
                className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
                onClick={() => setMediaModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              {mediaLoading ? (
                <p className="text-sm text-stone-600">Loading media...</p>
              ) : mediaItems.length === 0 ? (
                <p className="text-sm text-stone-600">No media files found for this site.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {mediaItems.map((item) => (
                    <button
                      key={`media-modal-${item.id}`}
                      type="button"
                      className="group overflow-hidden rounded-lg border border-stone-200 bg-stone-50 text-left hover:border-cyan-300 hover:bg-cyan-50"
                      onClick={() => {
                        if (enableThumbnail && mediaModalMode === "thumbnail") {
                          setThumbnailFromMediaItem(item);
                          setMediaModalOpen(false);
                          return;
                        }
                        const editor = editorRef.current;
                        if (!editor) return;
                        editor
                          .chain()
                          .focus()
                          .setImage({ src: item.url, alt: item.label || "Site media image" })
                          .run();
                        enqueueSave(true);
                        setMediaModalOpen(false);
                        toast.success("Inserted media from library.");
                      }}
                    >
                      <div className="aspect-square w-full overflow-hidden bg-stone-100">
                        <img
                          src={item.url}
                          alt={item.label || item.objectKey}
                          className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                      </div>
                      <div className="p-2">
                        <div className="truncate text-[11px] font-semibold text-stone-800">
                          {item.label || item.objectKey.split("/").pop() || item.objectKey}
                        </div>
                        <div className="truncate text-[10px] text-stone-500">{item.provider}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
