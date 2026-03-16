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
import { useEffect, useMemo, useRef, useState, useTransition, type SetStateAction } from "react";
import { defaultExtensions } from "./extensions/editor-extensions";
import PluginEditorTabPanel, { type EditorPluginTabDescriptor } from "./plugin-editor-tab-panel";
import { createUploadFn } from "@/components/tailwind/image-upload";
import { getSuggestionItems, setCurrentPost, setPluginSuggestionItems, slashCommand } from "@/components/tailwind/slash-command";
import {
  createTaxonomyTerm,
  deleteDomainPost,
  updateDomainPost,
  updateDomainPostMetadata,
} from "@/lib/actions";
import TextareaAutosize from "react-textarea-autosize";
import { cn } from "@/lib/utils";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  Link2,
  Unlink2,
} from "lucide-react";

const POST_PASSWORD_KEY = "password" as const;
import { toast } from "sonner";
import LoadingDots from "../icons/loading-dots";
import { getSitePublicUrl } from "@/lib/site-url";
import { createSaveQueue, type SaveQueueStatus } from "@/lib/editor-save-queue";
import { uploadSmart } from "@/lib/uploadSmart";
import { DEFAULT_TOOTY_IMAGE } from "@/lib/tooty-images";
import { useMediaPicker } from "@/components/media/use-media-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/tailwind/ui/dialog";
import {
  filterVisibleEditorMetaEntries,
  upsertEditorMetaEntry,
  updateEditorMetaEntryValue,
} from "@/lib/editor-meta";
import {
  computeEditorConvergence,
  shouldMarkEditorStateDirty,
} from "@/lib/editor-convergence";
import { shouldPreserveNewerLocalDraft } from "@/lib/editor-save-reconciliation";
import { sortEditorPluginTabs } from "@/lib/editor-plugin-tabs";
import { normalizeSeoSlug, normalizeSlugDraft } from "@/lib/slug";
import { buildEditorSaveSignature } from "@/lib/editor-save-signature";
import {
  readEditorTextInputMeta,
  shouldAcceptEditorFieldMutation,
  shouldAcceptEditorTextFieldCommit,
  shouldAcceptEditorTextFieldMutation,
} from "@/lib/editor-text-input";
import { resolveDomainPostEditorAutosavePath } from "@/lib/editor-autosave-route";
import {
  DEFAULT_EDITOR_REFERENCE_DATA,
  DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS,
  isEagerEditorTaxonomy,
  normalizeEditorReferenceData,
  shouldAllowManualEditorTaxonomyExpansion,
  type EditorReferenceData,
  type EditorReferenceTaxonomyRow,
  type EditorReferenceTaxonomyTerm,
} from "@/lib/editor-reference-data";
import {
  buildEditorTaxonomyAutoloadState,
  buildEditorTaxonomyLoadState,
  shouldFetchEditorTaxonomyTermsFromNetwork,
  type EditorAutoloadContext,
  type EditorTaxonomyAutoloadStatus,
  type EditorTaxonomyLoadStatus,
} from "@/lib/editor-taxonomy-loading";
import {
  primeEditorTaxonomyReferenceCache,
  readEditorTaxonomyReferenceCache,
  runWithEditorTaxonomyReferenceCache,
} from "@/lib/editor-taxonomy-reference-cache";
import { useParams, useRouter } from "next/navigation";

type EditorMode = "html-css-first" | "rich-text";
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
type EditorSidebarTab = {
  id: string;
  label: string;
  order: number;
  kind: "core" | "plugin";
  pluginTab?: EditorPluginTabDescriptor;
};
type EditorFooterPanel = {
  id: string;
  title: string;
  content: string;
};
type EditorFieldGestureKey =
  | "title"
  | "description"
  | "slug"
  | "password"
  | "layout"
  | "usePassword"
  | "useComments";
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
  dataDomainId?: number | null;
  dataDomainKey?: string | null;
  dataDomainLabel?: string | null;
  title: string | null;
  description: string | null;
  content: string | null;
  password?: string | null;
  usePassword?: boolean | null;
  layout: string | null;
  slug: string;
  published: boolean;
  image?: string | null;
  imageBlurhash?: string | null;
  userId?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
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

type TaxonomyOverviewRow = EditorReferenceTaxonomyRow;

type TaxonomyTerm = EditorReferenceTaxonomyTerm;

type EditorSessionCacheEntry = {
  version: 5;
  savedAt: number;
  dirty: boolean;
  signature: string;
  payload: {
    id: string;
    title: string;
    description: string;
    slug: string;
    content: string;
    published: boolean;
    password: string;
    usePassword: boolean;
    layout: string | null;
    selectedTermsByTaxonomy: Record<string, number[]>;
    termNameById: Record<number, string>;
    categoryIds: number[];
    tagIds: number[];
    taxonomyIds: number[];
    metaEntries: PostMetaEntry[];
  };
};

const EDITOR_SESSION_CACHE_VERSION = 5;
const EDITOR_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const EDITOR_SESSION_CACHE_CONSISTENCY_SKEW_MS = 2 * 60 * 1000;
const EDITOR_SESSION_CACHE_KEY_PREFIX = "tooty.editor.snapshot.v1:";
const EDITOR_SIDEBAR_TAB_KEY_PREFIX = "tooty.editor.sidebar-tab.v1:";
const EDITOR_RUNTIME_VERSION = "2026-03-13.3";
const EDITOR_RUNTIME_VERSION_KEY = "tooty.editor.runtime.version";
const EDITOR_USER_INTENT_WINDOW_MS = 5_000;

type SavePostAction = (data: {
  id: string;
  siteId?: string | null;
  dataDomainKey?: string | null;
  title?: string | null;
  description?: string | null;
  slug?: string;
  content?: string | null;
  password?: string | null;
  usePassword?: boolean | null;
  layout?: string | null;
  categoryIds?: number[];
  tagIds?: number[];
  taxonomyIds?: number[];
  metaEntries?: Array<{ key: string; value: string }>;
}) => Promise<any>;

type UpdatePostMetadataAction = (formData: FormData, postId: string, key: string) => Promise<any>;

type EditorSaveSnapshot = {
  data?: PostWithSite;
  selectedTermsByTaxonomy?: Record<string, number[]>;
  metaEntries?: PostMetaEntry[];
  content?: string;
  userMutationSequence?: number;
};

type ApplyDataUpdateOptions = {
  markDirty?: boolean;
  reason?: string;
  userMutation?: boolean;
};

function normalizeEditorJsonContent(input: JSONContent | null | undefined): JSONContent {
  if (!input || input.type !== "doc") {
    return defaultEditorContent as JSONContent;
  }
  return {
    ...input,
    content: Array.isArray(input.content) ? input.content : [],
  } as JSONContent;
}

function parseInitialContent(raw: string | null | undefined): JSONContent {
  if (!raw) return defaultEditorContent as JSONContent;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.type === "doc") return normalizeEditorJsonContent(parsed as JSONContent);
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

function deriveSelectedTermsByTaxonomy(post: PostWithSite) {
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
  return { selected, nextTermNameById };
}

function getAllSelectedTaxonomyIds(selected: Record<string, number[]>) {
  return Array.from(
    new Set(
      Object.values(selected)
        .flat()
        .filter((id): id is number => Number.isFinite(id)),
    ),
  ).sort((left, right) => left - right);
}

function normalizeSelectedTermsByTaxonomy(selected: Record<string, number[]>) {
  const entries = Object.entries(selected)
    .map(
      ([taxonomy, ids]) =>
        [
          taxonomy,
          Array.from(new Set((Array.isArray(ids) ? ids : []).filter((id): id is number => Number.isFinite(id)))).sort(
            (left, right) => left - right,
          ),
        ] as const,
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function normalizeMetaEntriesForPersistence(metaEntries: PostMetaEntry[]) {
  return [...metaEntries]
    .map((entry) => ({
      key: String(entry.key || ""),
      value: String(entry.value || ""),
    }))
    .sort((left, right) => {
      const keyComparison = left.key.localeCompare(right.key);
      if (keyComparison !== 0) return keyComparison;
      return left.value.localeCompare(right.value);
    });
}

function buildEditorStateSignature(input: {
  post: PostWithSite;
  content: JSONContent;
  selectedTermsByTaxonomy: Record<string, number[]>;
  metaEntries: PostMetaEntry[];
}) {
  const { post, content, selectedTermsByTaxonomy, metaEntries } = input;
  const normalizedContent = normalizeEditorJsonContent(content);
  const normalizedSelectedTermsByTaxonomy = normalizeSelectedTermsByTaxonomy(selectedTermsByTaxonomy);
  const normalizedMetaEntries = normalizeMetaEntriesForPersistence(metaEntries);
  return buildEditorSaveSignature({
    id: post.id,
    title: post.title ?? "",
    description: post.description ?? "",
    slug: post.slug ?? "",
    content: JSON.stringify(normalizedContent),
    published: Boolean(post.published),
    password: post.password ?? "",
    usePassword: Boolean(post.usePassword),
    layout: post.layout ?? null,
    selectedTermsByTaxonomy: normalizedSelectedTermsByTaxonomy,
    categoryIds: normalizedSelectedTermsByTaxonomy.category ?? [],
    tagIds: normalizedSelectedTermsByTaxonomy.tag ?? [],
    taxonomyIds: getAllSelectedTaxonomyIds(normalizedSelectedTermsByTaxonomy),
    metaEntries: normalizedMetaEntries,
  });
}

function getEditorSessionCacheKey(postId: string) {
  return `${EDITOR_SESSION_CACHE_KEY_PREFIX}${String(postId || "").trim()}`;
}

function readEditorSessionCache(postId: string): EditorSessionCacheEntry | null {
  if (typeof window === "undefined") return null;
  const cacheKey = getEditorSessionCacheKey(postId);
  const raw = window.sessionStorage.getItem(cacheKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EditorSessionCacheEntry>;
    if (parsed.version !== EDITOR_SESSION_CACHE_VERSION) {
      window.sessionStorage.removeItem(cacheKey);
      return null;
    }
    if (!parsed.savedAt || Date.now() - parsed.savedAt > EDITOR_SESSION_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(cacheKey);
      return null;
    }
    if (parsed.dirty !== true) {
      window.sessionStorage.removeItem(cacheKey);
      return null;
    }
    if (!parsed.payload || parsed.payload.id !== postId || !parsed.signature) return null;
    return parsed as EditorSessionCacheEntry;
  } catch {
    window.sessionStorage.removeItem(cacheKey);
    return null;
  }
}

function writeEditorSessionCache(
  postId: string,
  payload: EditorSessionCacheEntry["payload"],
  signature: string,
  dirty = true,
) {
  if (typeof window === "undefined") return;
  const cacheKey = getEditorSessionCacheKey(postId);
  const entry: EditorSessionCacheEntry = {
    version: EDITOR_SESSION_CACHE_VERSION,
    savedAt: Date.now(),
    dirty,
    signature,
    payload,
  };
  window.sessionStorage.setItem(cacheKey, JSON.stringify(entry));
}

function clearEditorSessionCache(postId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(getEditorSessionCacheKey(postId));
}

function clearAllEditorSessionState() {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (!key) continue;
    if (key.startsWith(EDITOR_SESSION_CACHE_KEY_PREFIX) || key.startsWith(EDITOR_SIDEBAR_TAB_KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    window.sessionStorage.removeItem(key);
  }
}

function readEditorSidebarTab(postId: string): string | null {
  if (typeof window === "undefined") return null;
  const normalizedPostId = String(postId || "").trim();
  if (!normalizedPostId) return null;
  const raw = window.sessionStorage.getItem(`${EDITOR_SIDEBAR_TAB_KEY_PREFIX}${normalizedPostId}`);
  const value = String(raw || "").trim();
  return value || null;
}

function writeEditorSidebarTab(postId: string, tabId: string) {
  if (typeof window === "undefined") return;
  const normalizedPostId = String(postId || "").trim();
  const normalizedTabId = String(tabId || "").trim();
  if (!normalizedPostId || !normalizedTabId) return;
  window.sessionStorage.setItem(`${EDITOR_SIDEBAR_TAB_KEY_PREFIX}${normalizedPostId}`, normalizedTabId);
}

function hasMeaningfulEditorContent(raw: string | null | undefined) {
  const normalized = String(raw || "").trim();
  if (!normalized) return false;
  try {
    return JSON.stringify(JSON.parse(normalized)) !== JSON.stringify(defaultEditorContent);
  } catch {
    return true;
  }
}

function getEditorPayloadCompletenessScore(input: {
  title?: string | null;
  description?: string | null;
  slug?: string | null;
  content?: string | null;
  selectedTermsByTaxonomy?: Record<string, number[]>;
  metaEntries?: Array<{ key: string; value: string }>;
}) {
  let score = 0;
  if (String(input.title || "").trim()) score += 4;
  if (String(input.slug || "").trim()) score += 3;
  if (String(input.description || "").trim()) score += 2;
  if (hasMeaningfulEditorContent(input.content)) score += 6;
  score += Object.values(input.selectedTermsByTaxonomy ?? {}).reduce(
    (total, ids) => total + (Array.isArray(ids) ? ids.length : 0),
    0,
  );
  score += Array.isArray(input.metaEntries) ? input.metaEntries.length : 0;
  return score;
}

function getSelectedTermCount(selectedTermsByTaxonomy?: Record<string, number[]>) {
  return Object.values(selectedTermsByTaxonomy ?? {}).reduce(
    (total, ids) => total + (Array.isArray(ids) ? ids.length : 0),
    0,
  );
}

function isPlaceholderServerDraft(input: {
  id: string;
  title?: string | null;
  description?: string | null;
  slug?: string | null;
  content?: string | null;
  selectedTermsByTaxonomy?: Record<string, number[]>;
  metaEntries?: Array<{ key: string; value: string }>;
}) {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const slug = String(input.slug || "").trim();
  const hasSelectedTerms = Object.values(input.selectedTermsByTaxonomy ?? {}).some(
    (ids) => Array.isArray(ids) && ids.length > 0,
  );
  const hasVisibleMetaEntries = Array.isArray(input.metaEntries) && input.metaEntries.length > 0;
  const looksLikeDefaultDraftSlug =
    !slug ||
    slug === `post-${input.id}` ||
    slug === `page-${input.id}` ||
    slug === `item-${input.id}` ||
    slug === normalizeSeoSlug(`post-${input.id}`) ||
    slug === normalizeSeoSlug(`page-${input.id}`) ||
    slug === normalizeSeoSlug(`item-${input.id}`);
  return (
    !title &&
    !description &&
    !hasMeaningfulEditorContent(input.content) &&
    !hasSelectedTerms &&
    !hasVisibleMetaEntries &&
    looksLikeDefaultDraftSlug
  );
}

function getInitialEditorClientState(
  post: PostWithSite,
  options?: {
    allowCachedDraftRecovery?: boolean;
  },
) {
  const allowCachedDraftRecovery = options?.allowCachedDraftRecovery === true;
  const content = parseInitialContent(post.content);
  const { selected, nextTermNameById } = deriveSelectedTermsByTaxonomy(post);
  const nextMeta = (post.meta ?? []).map((entry) => ({ key: entry.key, value: entry.value }));
  const incomingServerSignature = buildEditorStateSignature({
    post,
    content,
    selectedTermsByTaxonomy: selected,
    metaEntries: nextMeta,
  });
  const cachedEditorState = readEditorSessionCache(post.id);
  const incomingServerUpdatedAt = (() => {
    const raw = (post as PostWithSite & { updatedAt?: string | Date | null }).updatedAt;
    if (!raw) return 0;
    const parsed = raw instanceof Date ? raw : new Date(String(raw));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  })();
  const serverCompletenessScore = getEditorPayloadCompletenessScore({
    title: post.title,
    description: post.description,
    slug: post.slug,
    content: post.content,
    selectedTermsByTaxonomy: selected,
    metaEntries: nextMeta,
  });
  const cachedCompletenessScore = cachedEditorState
    ? getEditorPayloadCompletenessScore({
        title: cachedEditorState.payload.title,
        description: cachedEditorState.payload.description,
        slug: cachedEditorState.payload.slug,
        content: cachedEditorState.payload.content,
        selectedTermsByTaxonomy: cachedEditorState.payload.selectedTermsByTaxonomy,
        metaEntries: cachedEditorState.payload.metaEntries,
      })
    : 0;
  const shouldPreferCachedDraftOverPlaceholderServer =
    allowCachedDraftRecovery &&
    Boolean(cachedEditorState) &&
    cachedCompletenessScore > serverCompletenessScore &&
    isPlaceholderServerDraft({
      id: post.id,
      title: post.title,
      description: post.description,
      slug: post.slug,
      content: post.content,
      selectedTermsByTaxonomy: selected,
      metaEntries: nextMeta,
    });
  const serverSelectedTermCount = getSelectedTermCount(selected);
  const cachedSelectedTermCount = getSelectedTermCount(
    cachedEditorState?.payload.selectedTermsByTaxonomy,
  );
  const serverVisibleMetaCount = nextMeta.length;
  const cachedVisibleMetaCount = cachedEditorState?.payload.metaEntries.length ?? 0;
  const cacheIsFreshEnoughForIncompleteServer =
    allowCachedDraftRecovery &&
    Boolean(cachedEditorState) &&
    (incomingServerUpdatedAt <= 0 ||
      cachedEditorState!.savedAt + EDITOR_SESSION_CACHE_CONSISTENCY_SKEW_MS >=
        incomingServerUpdatedAt);
  const shouldPreferCachedEditorStateForIncompleteServer =
    allowCachedDraftRecovery &&
    Boolean(cachedEditorState) &&
    cacheIsFreshEnoughForIncompleteServer &&
    cachedCompletenessScore > serverCompletenessScore &&
    (cachedSelectedTermCount > serverSelectedTermCount ||
      cachedVisibleMetaCount > serverVisibleMetaCount);
  const shouldUseCachedEditorState =
    allowCachedDraftRecovery &&
    Boolean(cachedEditorState) &&
    cachedEditorState!.signature !== incomingServerSignature &&
    ((cachedCompletenessScore >= serverCompletenessScore &&
      cachedEditorState!.savedAt >= incomingServerUpdatedAt) ||
      shouldPreferCachedDraftOverPlaceholderServer ||
      shouldPreferCachedEditorStateForIncompleteServer);
  const effectiveContent = shouldUseCachedEditorState
    ? parseInitialContent(cachedEditorState!.payload.content)
    : content;
  const effectiveSelectedTermsByTaxonomy = shouldUseCachedEditorState
    ? cachedEditorState!.payload.selectedTermsByTaxonomy
    : selected;
  const effectiveTermNameById = shouldUseCachedEditorState ? cachedEditorState!.payload.termNameById : nextTermNameById;
  const effectiveMetaEntries = shouldUseCachedEditorState ? cachedEditorState!.payload.metaEntries : nextMeta;
  const effectivePost = shouldUseCachedEditorState
    ? {
        ...post,
        title: cachedEditorState!.payload.title,
        description: cachedEditorState!.payload.description,
        slug: cachedEditorState!.payload.slug,
        content: cachedEditorState!.payload.content,
        published: cachedEditorState!.payload.published,
        [POST_PASSWORD_KEY]: cachedEditorState!.payload.password,
        usePassword: cachedEditorState!.payload.usePassword,
        layout: cachedEditorState!.payload.layout,
        meta: cachedEditorState!.payload.metaEntries,
      }
    : post;
  const incomingSignature = shouldUseCachedEditorState ? cachedEditorState!.signature : incomingServerSignature;

  return {
    incomingServerSignature,
    incomingSignature,
    shouldUseCachedEditorState,
    cachedEditorState,
    post: effectivePost,
    content: effectiveContent,
    selectedTermsByTaxonomy: effectiveSelectedTermsByTaxonomy,
    termNameById: effectiveTermNameById,
    metaEntries: effectiveMetaEntries,
  };
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

function readMetaBoolean(entries: PostMetaEntry[], key: string, fallback = true) {
  const match = entries.find((entry) => String(entry.key || "").trim().toLowerCase() === key.toLowerCase());
  if (!match) return fallback;
  const normalized = String(match.value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

const HIDDEN_PUBLISH_AT_META_KEY = "_publish_at";

function readHiddenMetaValue(entries: PostMetaEntry[], key: string) {
  const match = entries.find((entry) => String(entry.key || "").trim().toLowerCase() === key.toLowerCase());
  const value = String(match?.value || "").trim();
  return value || null;
}

function toDateTimeLocalInputValue(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toScheduledPublishIso(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function formatScheduledPublishLabel(value: string | null) {
  if (!value) return "Publish: immediately";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Publish: immediately";
  return `Publish: ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed)}`;
}

async function fetchTaxonomyTermsForEditor(input: {
  siteId: string;
  taxonomy: string;
  limit?: number;
}): Promise<TaxonomyTerm[]> {
  const normalizedTaxonomy = String(input.taxonomy || "").trim();
  if (isEagerEditorTaxonomy(normalizedTaxonomy)) {
    // Persisted item editors already receive eager taxonomy terms from the server.
    // If stale UI code asks again, fail closed to the local/cache snapshot instead
    // of issuing another network request that can loop forever on empty results.
    return (
      readEditorTaxonomyReferenceCache({
        siteId: input.siteId,
        taxonomy: normalizedTaxonomy,
        limit: input.limit,
      }) ?? []
    );
  }
  if (!shouldFetchEditorTaxonomyTermsFromNetwork({ taxonomy: normalizedTaxonomy })) {
    return (
      readEditorTaxonomyReferenceCache({
        siteId: input.siteId,
        taxonomy: normalizedTaxonomy,
        limit: input.limit,
      }) ?? []
    );
  }

  const query = new URLSearchParams({
    siteId: input.siteId,
    taxonomy: normalizedTaxonomy,
  });
  if (typeof input.limit === "number") {
    query.set("limit", String(input.limit));
  }
  const response = await fetch(`/api/editor/reference?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Failed to load taxonomy terms (${response.status})`);
  }
  const json = await response.json();
  const normalized = normalizeEditorReferenceData({
    taxonomyTermsByKey: {
      [normalizedTaxonomy]: Array.isArray(json?.terms) ? json.terms : [],
    },
  });
  return normalized.taxonomyTermsByKey[normalizedTaxonomy] || [];
}

function recordEditorDebugEvent(type: string, details: Record<string, unknown> = {}) {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const target = window as typeof window & {
    __TOOTY_EDITOR_DEBUG__?: Array<{
      at: number;
      type: string;
      details: Record<string, unknown>;
    }>;
  };
  const bucket = target.__TOOTY_EDITOR_DEBUG__ ?? [];
  bucket.push({ at: Date.now(), type, details });
  if (bucket.length > 200) {
    bucket.splice(0, bucket.length - 200);
  }
  target.__TOOTY_EDITOR_DEBUG__ = bucket;
}

export default function Editor({
  post,
  initialReferenceData = DEFAULT_EDITOR_REFERENCE_DATA,
  defaultEditorMode = "rich-text",
  defaultEnableComments = true,
  commentsPluginEnabled = true,
  onSave = updateDomainPost,
  autosaveEndpoint = null,
  onUpdateMetadata = updateDomainPostMetadata,
  enableThumbnail = true,
  canEdit = true,
  canPublish = true,
  materializeDraftOnFirstSave = false,
  allowCachedDraftRecovery = false,
  editorAutoloadContext,
}: {
  post: PostWithSite;
  initialReferenceData?: EditorReferenceData;
  defaultEditorMode?: EditorMode;
  defaultEnableComments?: boolean;
  commentsPluginEnabled?: boolean;
  onSave?: SavePostAction;
  autosaveEndpoint?: string | null;
  onUpdateMetadata?: UpdatePostMetadataAction;
  enableThumbnail?: boolean;
  canEdit?: boolean;
  canPublish?: boolean;
  materializeDraftOnFirstSave?: boolean;
  allowCachedDraftRecovery?: boolean;
  editorAutoloadContext?: EditorAutoloadContext;
}) {
  const resolvedEditorAutoloadContext: EditorAutoloadContext =
    editorAutoloadContext ?? (materializeDraftOnFirstSave ? "draft-shell" : "persisted-item");
  const initialClientState = useMemo(
    () => getInitialEditorClientState(post, { allowCachedDraftRecovery }),
    [allowCachedDraftRecovery, post],
  );
  const normalizedInitialReferenceData = useMemo(
    () => normalizeEditorReferenceData(initialReferenceData),
    [initialReferenceData],
  );
  const [initialContent, setInitialContent] = useState<JSONContent | null>(() => initialClientState.content);
  const [editorContentDigest, setEditorContentDigest] = useState<string>(
    () => JSON.stringify(initialClientState.content),
  );
  const [saveStatus, setSaveStatus] = useState<SaveQueueStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const [showPostPassword, setShowPostPassword] = useState(false);
  const [charsCount, setCharsCount] = useState<number>();
  const [taxonomyOverviewRows, setTaxonomyOverviewRows] = useState<TaxonomyOverviewRow[]>(
    normalizedInitialReferenceData.taxonomyOverviewRows,
  );
  const [taxonomyTermsByKey, setTaxonomyTermsByKey] = useState<Record<string, TaxonomyTerm[]>>(
    normalizedInitialReferenceData.taxonomyTermsByKey,
  );
  const [taxonomyLoadStateByKey, setTaxonomyLoadStateByKey] = useState<Record<string, EditorTaxonomyLoadStatus>>(
    () =>
      buildEditorTaxonomyLoadState(
        normalizedInitialReferenceData.taxonomyOverviewRows,
        normalizedInitialReferenceData.taxonomyTermsByKey,
      ),
  );
  const [taxonomyAutoloadStateByKey, setTaxonomyAutoloadStateByKey] = useState<
    Record<string, EditorTaxonomyAutoloadStatus>
  >(() =>
    buildEditorTaxonomyAutoloadState(
      normalizedInitialReferenceData.taxonomyOverviewRows,
      normalizedInitialReferenceData.taxonomyTermsByKey,
    ),
  );
  const [taxonomyExpanded, setTaxonomyExpanded] = useState<Record<string, boolean>>({});
  const [taxonomyLoadingMore, setTaxonomyLoadingMore] = useState<Record<string, boolean>>({});
  const [pendingTaxonomyWrites, setPendingTaxonomyWrites] = useState<Record<string, number>>({});
  const [selectedTermsByTaxonomy, setSelectedTermsByTaxonomy] = useState<Record<string, number[]>>(
    () => initialClientState.selectedTermsByTaxonomy,
  );
  const [termNameById, setTermNameById] = useState<Record<number, string>>(() => initialClientState.termNameById);
  const [metaEntries, setMetaEntries] = useState<PostMetaEntry[]>(() => initialClientState.metaEntries);
  const [metaKeySuggestions, setMetaKeySuggestions] = useState<string[]>(
    normalizedInitialReferenceData.metaKeySuggestions,
  );
  const [taxonomyInputByKey, setTaxonomyInputByKey] = useState<Record<string, string>>({});
  const [metaKeyInput, setMetaKeyInput] = useState("");
  const [metaValueInput, setMetaValueInput] = useState("");
  const [currentBlockMode, setCurrentBlockMode] = useState<string>("paragraph");
  const [currentTextAlign, setCurrentTextAlign] = useState<"left" | "center" | "right">("left");
  const [sidebarTab, setSidebarTab] = useState<string>(() => readEditorSidebarTab(post.id) || "document");
  const [editorMode, setEditorMode] = useState<EditorMode>(defaultEditorMode);
  const [htmlDraft, setHtmlDraft] = useState<string>("");
  const [editorPlugins, setEditorPlugins] = useState<EditorPlugin[]>([]);
  const [editorPluginTabs, setEditorPluginTabs] = useState<EditorPluginTabDescriptor[]>([]);
  const [editorFooterPanels, setEditorFooterPanels] = useState<EditorFooterPanel[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [postImageUrls, setPostImageUrls] = useState<string[]>(() =>
    Array.from(new Set(collectImageUrlsFromNode(initialClientState.content))),
  );
  const [mediaLoading, setMediaLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [, setToolbarTick] = useState(0);
  const { openMediaPicker, mediaPickerElement } = useMediaPicker();
  const router = useRouter();
  const params = useParams<{ id?: string; domainKey?: string; postId?: string }>();

  const editorRef = useRef<EditorInstance | null>(null);
  const htmlDirtyRef = useRef(false);
  const htmlDraftRef = useRef("");
  const titleValueRef = useRef<string>(initialClientState.post.title ?? "");
  const descriptionValueRef = useRef<string>(initialClientState.post.description ?? "");
  const slugValueRef = useRef<string>(initialClientState.post.slug ?? "");
  const pendingTaxonomyTasksRef = useRef(new Set<Promise<void>>());
  const pendingTaxonomyRequestKeysRef = useRef(new Set<string>());
  const selectedTermsByTaxonomyRef = useRef<Record<string, number[]>>(initialClientState.selectedTermsByTaxonomy);
  const termNameByIdRef = useRef<Record<number, string>>(initialClientState.termNameById);
  const taxonomyInputByKeyRef = useRef<Record<string, string>>({});
  const metaEntriesRef = useRef<PostMetaEntry[]>(initialClientState.metaEntries);
  const [data, setData] = useState<PostWithSite>(initialClientState.post);
  const dataRef = useRef<PostWithSite>(initialClientState.post);
  const lastQueuedSignatureRef = useRef<string>(initialClientState.incomingSignature);
  const lastSavedSignatureRef = useRef<string>(initialClientState.incomingSignature);
  const lastImageCountRef = useRef<number>(countImageNodes(initialClientState.content));
  const lastObservedEditorContentSignatureRef = useRef<string>(JSON.stringify(initialClientState.content));
  const lastRecoveredCacheAtRef = useRef<number>(initialClientState.cachedEditorState?.savedAt ?? 0);
  const lastLocalMutationAtRef = useRef<number>(0);
  const hasUserMutationSinceServerStateRef = useRef(false);
  const nextUserMutationSequenceRef = useRef(0);
  const latestUserMutationSequenceRef = useRef(0);
  const lastPersistedUserMutationSequenceRef = useRef(0);
  const lastUserIntentAtRef = useRef<number>(0);
  const lastEditorGestureAtRef = useRef<number>(0);
  const lastAutosaveRevisionRef = useRef(0);
  const lastFieldGestureAtRef = useRef<Record<EditorFieldGestureKey, number>>({
    title: 0,
    description: 0,
    slug: 0,
    password: 0,
    layout: 0,
    usePassword: 0,
    useComments: 0,
  });
  const skipNextAutosaveRef = useRef(false);
  const draftShellMaterializedRef = useRef(!materializeDraftOnFirstSave);
  const interactionArmedByUserRef = useRef(materializeDraftOnFirstSave);
  const sidebarTabListRef = useRef<HTMLDivElement | null>(null);
  const sidebarTabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    draftShellMaterializedRef.current = !materializeDraftOnFirstSave;
    interactionArmedByUserRef.current = materializeDraftOnFirstSave;
  }, [materializeDraftOnFirstSave, post.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentRuntimeVersion = window.sessionStorage.getItem(EDITOR_RUNTIME_VERSION_KEY);
    if (currentRuntimeVersion === EDITOR_RUNTIME_VERSION) return;
    clearAllEditorSessionState();
    window.sessionStorage.setItem(EDITOR_RUNTIME_VERSION_KEY, EDITOR_RUNTIME_VERSION);
    recordEditorDebugEvent("editorRuntimeVersionReset", {
      previousVersion: currentRuntimeVersion,
      nextVersion: EDITOR_RUNTIME_VERSION,
    });
  }, []);

  const recordUserMutationSequence = () => {
    const nextSequence = nextUserMutationSequenceRef.current + 1;
    nextUserMutationSequenceRef.current = nextSequence;
    latestUserMutationSequenceRef.current = nextSequence;
    return nextSequence;
  };

  const resetUserMutationSequence = (persistedSequence = 0) => {
    nextUserMutationSequenceRef.current = persistedSequence;
    latestUserMutationSequenceRef.current = persistedSequence;
    lastPersistedUserMutationSequenceRef.current = persistedSequence;
  };

  useEffect(() => {
    const {
      post: effectivePost,
      content: effectiveContent,
      selectedTermsByTaxonomy: effectiveSelectedTermsByTaxonomy,
      termNameById: effectiveTermNameById,
      metaEntries: effectiveMetaEntries,
      incomingSignature,
      shouldUseCachedEditorState,
      cachedEditorState,
    } = getInitialEditorClientState(post, { allowCachedDraftRecovery });
    const currentClientContent = (() => {
      const editor = editorRef.current;
      if (editor) {
        try {
          return JSON.stringify(editor.getJSON());
        } catch {
          // fall through to current data snapshot
        }
      }
      return dataRef.current?.content ?? "";
    })();
    const currentClientPost: PostWithSite = {
      ...(dataRef.current ?? post),
      title: titleValueRef.current ?? dataRef.current?.title ?? "",
      description: descriptionValueRef.current ?? dataRef.current?.description ?? "",
      slug: slugValueRef.current ?? dataRef.current?.slug ?? "",
      content: currentClientContent,
      meta: metaEntriesRef.current,
    };
    const currentClientSignature = buildEditorStateSignature({
      post: currentClientPost,
      content: parseInitialContent(currentClientContent),
      selectedTermsByTaxonomy: selectedTermsByTaxonomyRef.current,
      metaEntries: metaEntriesRef.current,
    });
    const convergence = computeEditorConvergence({
      currentClientSignature,
      lastQueuedSignature: lastQueuedSignatureRef.current,
      lastSavedSignature: lastSavedSignatureRef.current,
      incomingSignature,
      samePost: dataRef.current?.id === post.id,
      lastLocalMutationAt: lastLocalMutationAtRef.current,
      lastRecoveredCacheAt: lastRecoveredCacheAtRef.current,
      shouldUseCachedEditorState,
    });

    setCurrentPost(effectivePost);
    if (convergence.shouldPreserveLocalState) {
      if (hasUserMutationSinceServerStateRef.current) {
        recordEditorDebugEvent("postEffectPreservedLocalState", {
          hasUnsavedLocalState: convergence.hasUnsavedLocalState,
          preserveLocalDraft: convergence.preserveLocalDraft,
          preserveRecentLocalDraft: convergence.preserveRecentLocalDraft,
          preserveStaleIncomingPost: convergence.preserveStaleIncomingPost,
          shouldUseCachedEditorState,
        });
        return;
      }
      recordEditorDebugEvent("postEffectDroppedNonUserLocalState", {
        hasUnsavedLocalState: convergence.hasUnsavedLocalState,
        preserveLocalDraft: convergence.preserveLocalDraft,
        preserveRecentLocalDraft: convergence.preserveRecentLocalDraft,
        preserveStaleIncomingPost: convergence.preserveStaleIncomingPost,
      });
    }

    dataRef.current = effectivePost;
    setData(effectivePost);
    titleValueRef.current = effectivePost.title ?? "";
    descriptionValueRef.current = effectivePost.description ?? "";
    slugValueRef.current = effectivePost.slug ?? "";
    setInitialContent(effectiveContent);
    setEditorContentDigest(JSON.stringify(effectiveContent));
    recordEditorDebugEvent("postEffectAppliedServerState", {
      shouldUseCachedEditorState,
      incomingSignatureLength: incomingSignature.length,
      title: effectivePost.title ?? "",
      slug: String(effectivePost.slug || ""),
    });
    setPostImageUrls(Array.from(new Set(collectImageUrlsFromNode(effectiveContent))));
    lastObservedEditorContentSignatureRef.current = JSON.stringify(effectiveContent);
    setSelectedTermsByTaxonomy(effectiveSelectedTermsByTaxonomy);
    selectedTermsByTaxonomyRef.current = effectiveSelectedTermsByTaxonomy;
    applyTermNameByIdUpdate((prev) => ({ ...prev, ...effectiveTermNameById }));
    setMetaEntries(effectiveMetaEntries);
    metaEntriesRef.current = effectiveMetaEntries;
    lastImageCountRef.current = countImageNodes(effectiveContent);
    hasUserMutationSinceServerStateRef.current = false;
    lastLocalMutationAtRef.current = 0;
    lastUserIntentAtRef.current = 0;
    lastEditorGestureAtRef.current = 0;
    lastAutosaveRevisionRef.current = 0;
    resetInteractionArm("postEffect:serverStateApplied");
    resetUserMutationSequence();
    lastFieldGestureAtRef.current = {
      title: 0,
      description: 0,
      slug: 0,
      password: 0,
      layout: 0,
      usePassword: 0,
      useComments: 0,
    };
    setDirtyRevision(0);
    setSaveError(null);
    setSaveStatus("saved");
    lastSavedSignatureRef.current = incomingSignature;
    lastQueuedSignatureRef.current = incomingSignature;
    lastRecoveredCacheAtRef.current = shouldUseCachedEditorState ? cachedEditorState!.savedAt : 0;
    setShowPostPassword(false);
  }, [allowCachedDraftRecovery, post]);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const applyDataUpdate = (
    updater: SetStateAction<PostWithSite>,
    options: ApplyDataUpdateOptions = {},
  ) => {
    const current = dataRef.current;
    const next =
      typeof updater === "function" ? (updater as (value: PostWithSite) => PostWithSite)(current) : updater;
    dataRef.current = next;
    setData(next);
    if (options.markDirty) {
      markLocalDirty(
        options.reason || "applyDataUpdate",
        { data: next },
        { userMutation: options.userMutation === true },
      );
    }
  };

  const applyTermNameByIdUpdate = (
    updater:
      | Record<number, string>
      | ((prev: Record<number, string>) => Record<number, string>),
  ) => {
    const current = termNameByIdRef.current;
    const next =
      typeof updater === "function"
        ? (updater as (prev: Record<number, string>) => Record<number, string>)(current)
        : updater;
    termNameByIdRef.current = next;
    setTermNameById(next);
    return next;
  };

  useEffect(() => {
    selectedTermsByTaxonomyRef.current = selectedTermsByTaxonomy;
  }, [selectedTermsByTaxonomy]);
  useEffect(() => {
    taxonomyInputByKeyRef.current = taxonomyInputByKey;
  }, [taxonomyInputByKey]);
  useEffect(() => {
    metaEntriesRef.current = metaEntries;
  }, [metaEntries]);

  useEffect(() => {
    htmlDraftRef.current = htmlDraft;
  }, [htmlDraft]);

  const editorSidebarTabs = useMemo<EditorSidebarTab[]>(
    () =>
      sortEditorPluginTabs<EditorSidebarTab>([
        { id: "document", label: "Style", order: 100, kind: "core" },
        { id: "block", label: "Layout", order: 200, kind: "core" },
        { id: "plugins", label: "More", order: 300, kind: "core" },
        ...editorPluginTabs.map((tab) => ({
          id: `plugin:${tab.pluginId}:${tab.id}`,
          label: tab.label,
          order: Number.isFinite(Number(tab.order)) ? Number(tab.order) : 400,
          kind: "plugin" as const,
          pluginTab: tab,
        })),
      ]),
    [editorPluginTabs],
  );

  useEffect(() => {
    const storedSidebarTab = readEditorSidebarTab(post.id);
    if (storedSidebarTab && editorSidebarTabs.some((tab) => tab.id === storedSidebarTab)) {
      setSidebarTab(storedSidebarTab);
      return;
    }
    if (!editorSidebarTabs.some((tab) => tab.id === sidebarTab)) {
      setSidebarTab(editorSidebarTabs[0]?.id || "document");
    }
  }, [editorSidebarTabs, post.id]);

  useEffect(() => {
    if (!editorSidebarTabs.some((tab) => tab.id === sidebarTab)) return;
    writeEditorSidebarTab(post.id, sidebarTab);
  }, [post.id, sidebarTab, editorSidebarTabs]);

  useEffect(() => {
    const activeButton = sidebarTabButtonRefs.current[sidebarTab];
    activeButton?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [sidebarTab]);

  useEffect(() => {
    const siteId = String(post.siteId || "").trim();
    if (!siteId) return;
    const seededReferenceData = normalizeEditorReferenceData(normalizedInitialReferenceData);
    setTaxonomyOverviewRows(seededReferenceData.taxonomyOverviewRows);
    setTaxonomyTermsByKey(seededReferenceData.taxonomyTermsByKey);
    setTaxonomyLoadStateByKey(
      buildEditorTaxonomyLoadState(
        seededReferenceData.taxonomyOverviewRows,
        seededReferenceData.taxonomyTermsByKey,
      ),
    );
    setTaxonomyAutoloadStateByKey(
      buildEditorTaxonomyAutoloadState(
        seededReferenceData.taxonomyOverviewRows,
        seededReferenceData.taxonomyTermsByKey,
      ),
    );
    primeEditorTaxonomyReferenceCache({
      siteId,
      taxonomyTermsByKey: seededReferenceData.taxonomyTermsByKey,
    });
    setMetaKeySuggestions(seededReferenceData.metaKeySuggestions);
    applyTermNameByIdUpdate((prev) => {
      const next = { ...prev };
      for (const rows of Object.values(seededReferenceData.taxonomyTermsByKey)) {
        for (const term of rows) {
          next[term.id] = term.name;
        }
      }
      return next;
    });
    setTaxonomyExpanded((prev) => {
      const next = { ...prev };
      for (const taxonomy of seededReferenceData.taxonomyOverviewRows.map((row) => row.taxonomy)) {
        if (
          isEagerEditorTaxonomy(taxonomy) &&
          Object.prototype.hasOwnProperty.call(seededReferenceData.taxonomyTermsByKey, taxonomy)
        ) {
          next[taxonomy] = true;
        }
        }
      return next;
    });
    recordEditorDebugEvent("editorReferenceSeededFromServer", {
      editorAutoloadContext: resolvedEditorAutoloadContext,
      siteId,
      taxonomyOverviewCount: seededReferenceData.taxonomyOverviewRows.length,
      taxonomyKeyCount: Object.keys(seededReferenceData.taxonomyTermsByKey).length,
      metaKeyCount: seededReferenceData.metaKeySuggestions.length,
    });
  }, [normalizedInitialReferenceData, post.siteId, resolvedEditorAutoloadContext]);

  useEffect(() => {
    if (resolvedEditorAutoloadContext !== "persisted-item") return;

    const eagerTaxonomies = taxonomyOverviewRows
      .map((row) => String(row?.taxonomy || "").trim())
      .filter((taxonomy) => taxonomy && isEagerEditorTaxonomy(taxonomy))
      .filter((taxonomy, index, rows) => rows.indexOf(taxonomy) === index);

    if (eagerTaxonomies.length === 0) return;

    setTaxonomyLoadStateByKey((prev) => {
      const next = { ...prev };
      for (const taxonomy of eagerTaxonomies) {
        next[taxonomy] = "loaded";
      }
      return next;
    });
    setTaxonomyAutoloadStateByKey((prev) => {
      const next = { ...prev };
      for (const taxonomy of eagerTaxonomies) {
        next[taxonomy] = "settled";
      }
      return next;
    });
    setTaxonomyExpanded((prev) => {
      const next = { ...prev };
      for (const taxonomy of eagerTaxonomies) {
        next[taxonomy] = true;
      }
      return next;
    });
    primeEditorTaxonomyReferenceCache({
      siteId: String(post.siteId || ""),
      taxonomyTermsByKey: Object.fromEntries(
        eagerTaxonomies.map((taxonomy) => [taxonomy, taxonomyTermsByKey[taxonomy] ?? []] as const),
      ),
    });
    recordEditorDebugEvent("persistedItemEagerTaxonomiesSettled", {
      eagerTaxonomies,
      siteId: String(post.siteId || ""),
    });
  }, [post.siteId, resolvedEditorAutoloadContext, taxonomyOverviewRows, taxonomyTermsByKey]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (post.siteId) query.set("siteId", post.siteId);
    if (post.id) query.set("postId", post.id);
    const currentDomainKey = String(post.dataDomainKey || params?.domainKey || "").trim();
    if (currentDomainKey) query.set("dataDomainKey", currentDomainKey);
    fetch(`/api/plugins/editor?${query.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { plugins: [] }))
      .then((json) => {
        const plugins = Array.isArray(json.plugins) ? json.plugins : [];
        setEditorPlugins(plugins);
        const tabs = Array.isArray(json.tabs) ? json.tabs : [];
        setEditorPluginTabs(
          sortEditorPluginTabs(
            tabs
              .map((tab: any) => ({
                id: String(tab?.id || ""),
                label: String(tab?.label || ""),
                order: Number.isFinite(Number(tab?.order)) ? Number(tab.order) : 400,
                pluginId: String(tab?.pluginId || ""),
                pluginName: String(tab?.pluginName || ""),
                supportsDomains: Array.isArray(tab?.supportsDomains)
                  ? tab.supportsDomains.map((entry: unknown) => String(entry || ""))
                  : undefined,
                requiresCapability: typeof tab?.requiresCapability === "string" ? tab.requiresCapability : undefined,
                sections: Array.isArray(tab?.sections) ? tab.sections : [],
              }))
              .filter((tab: EditorPluginTabDescriptor) => tab.id && tab.label && tab.pluginId && tab.sections.length > 0),
          ),
        );
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
        setEditorPluginTabs([]);
        setEditorFooterPanels([]);
        setPluginSuggestionItems([]);
      });
  }, [post.siteId, post.id, post.dataDomainKey, params?.domainKey]);

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

  const persistSavePayload = async (payload: {
    id: string;
    siteId: string | null;
    dataDomainKey: string | null;
    title: string;
    description: string;
    slug: string;
    content: string;
    password: string;
    usePassword: boolean;
    layout: string | null;
    selectedTermsByTaxonomy: Record<string, number[]>;
    categoryIds: number[];
    tagIds: number[];
    taxonomyIds: number[];
    metaEntries: PostMetaEntry[];
    signature: string;
    userMutationSequence: number;
  }) => {
    const resolvedAutosaveEndpoint = resolveDomainPostEditorAutosavePath(payload.id, autosaveEndpoint);
    if (resolvedAutosaveEndpoint) {
      const response = await fetch(resolvedAutosaveEndpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({ error: "Autosave request failed." }));
      if (!response.ok || (result && typeof result === "object" && "error" in result && result.error)) {
        throw new Error(
          typeof result?.error === "string" && result.error.trim().length > 0
            ? result.error
            : "Autosave request failed.",
        );
      }
      return result;
    }

    if (typeof window !== "undefined") {
      throw new Error("Editor autosave endpoint is missing for a browser-side save.");
    }

    return onSave(payload);
  };

  const uploadFn = createUploadFn(post.siteId || "default", "post");
  const [isPendingPublishAction, startTransitionPublishAction] = useTransition();
  const [isPendingPublishSchedule, startTransitionPublishSchedule] = useTransition();
  const [isPendingThumbnail, startTransitionThumbnail] = useTransition();
  const [isPendingDelete, startTransitionDelete] = useTransition();
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const slugInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const layoutSelectRef = useRef<HTMLSelectElement | null>(null);
  const usePasswordCheckboxRef = useRef<HTMLInputElement | null>(null);
  const useCommentsCheckboxRef = useRef<HTMLInputElement | null>(null);
  const taxonomyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [publishScheduleDialogOpen, setPublishScheduleDialogOpen] = useState(false);
  const [publishScheduleDraft, setPublishScheduleDraft] = useState("");

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
        siteId: string | null;
        dataDomainKey: string | null;
        title: string;
        description: string;
        slug: string;
        content: string;
        password: string;
        usePassword: boolean;
        layout: string | null;
        selectedTermsByTaxonomy: Record<string, number[]>;
        categoryIds: number[];
        tagIds: number[];
        taxonomyIds: number[];
        metaEntries: PostMetaEntry[];
        signature: string;
        userMutationSequence: number;
      }>({
        debounceMs: 600,
        save: async (payload) => {
          const result = await persistSavePayload(payload);
          if ((result as any)?.error) {
            throw new Error(String((result as any).error));
          }
          const currentLocalPost = dataRef.current;
          const currentLocalSelectedTermsByTaxonomy = selectedTermsByTaxonomyRef.current;
          const currentLocalMetaEntries = metaEntriesRef.current;
          const currentLocalTitle = titleValueRef.current;
          const currentLocalDescription = descriptionValueRef.current;
          const currentLocalContent = JSON.stringify(getContentJSON());
          const currentLocalPasswordValue = currentLocalPost.password ?? "";
          const currentLocalSignature = buildEditorSaveSignature({
            id: currentLocalPost.id,
            title: currentLocalTitle,
            description: currentLocalDescription,
            slug: normalizeSeoSlug(slugValueRef.current || currentLocalPost.slug || ""),
            content: currentLocalContent,
            published: Boolean(currentLocalPost.published),
            [passwordFieldKey]: currentLocalPasswordValue,
            usePassword: Boolean(currentLocalPost.usePassword),
            layout: currentLocalPost.layout ?? null,
            selectedTermsByTaxonomy: currentLocalSelectedTermsByTaxonomy,
            categoryIds: currentLocalSelectedTermsByTaxonomy.category ?? [],
            tagIds: currentLocalSelectedTermsByTaxonomy.tag ?? [],
            taxonomyIds: getAllSelectedTaxonomyIds(currentLocalSelectedTermsByTaxonomy),
            metaEntries: currentLocalMetaEntries,
          });
          const preserveNewerLocalDraft = shouldPreserveNewerLocalDraft({
            latestUserMutationSequence: latestUserMutationSequenceRef.current,
            payloadUserMutationSequence: payload.userMutationSequence,
            currentClientSignature: currentLocalSignature,
            payloadSignature: payload.signature,
            lastSavedSignature: lastSavedSignatureRef.current,
          });
          const currentLocalSlug = normalizeSeoSlug(
            preserveNewerLocalDraft
              ? (slugValueRef.current || currentLocalPost.slug || payload.slug || String((result as any)?.slug || "").trim())
              : String((result as any)?.slug || payload.slug || "").trim(),
          );
          const currentLocalTermNameById = termNameByIdRef.current;
          const nextMetaEntries = normalizeMetaEntriesForPersistence(
            Array.isArray((result as any)?.meta)
              ? ((result as any).meta as Array<{ key?: string; value?: string }>).map((entry) => ({
                  key: String(entry?.key || ""),
                  value: String(entry?.value || ""),
                }))
              : preserveNewerLocalDraft
                ? currentLocalMetaEntries
                : payload.metaEntries,
          );
          const nextPost: PostWithSite = {
            ...currentLocalPost,
            ...(result && typeof result === "object" ? result : {}),
            siteId: String((result as any)?.siteId || payload.siteId || currentLocalPost.siteId || "").trim() || null,
            dataDomainKey:
              String((result as any)?.dataDomainKey || payload.dataDomainKey || currentLocalPost.dataDomainKey || "").trim() ||
              null,
            title: preserveNewerLocalDraft ? currentLocalTitle : payload.title,
            description: preserveNewerLocalDraft
              ? currentLocalDescription
              : payload.description,
            slug: currentLocalSlug,
            content: preserveNewerLocalDraft ? (currentLocalPost.content ?? payload.content) : payload.content,
            [passwordFieldKey]: preserveNewerLocalDraft
              ? (currentLocalPost.password ?? payload.password)
              : payload.password,
            usePassword: preserveNewerLocalDraft ? Boolean(currentLocalPost.usePassword) : payload.usePassword,
            layout: preserveNewerLocalDraft ? (currentLocalPost.layout ?? payload.layout) : payload.layout,
            meta: nextMetaEntries,
          };
          const nextPasswordValue = nextPost[passwordFieldKey] ?? "";
          const derivedTaxonomyState = deriveSelectedTermsByTaxonomy(nextPost);
          const nextSelectedTermsByTaxonomy = normalizeSelectedTermsByTaxonomy(
            preserveNewerLocalDraft ? currentLocalSelectedTermsByTaxonomy : payload.selectedTermsByTaxonomy,
          );
          const nextTermNameById = {
            ...currentLocalTermNameById,
            ...derivedTaxonomyState.nextTermNameById,
          };
          const nextSignature = buildEditorSaveSignature({
            id: nextPost.id,
            title: nextPost.title ?? "",
            description: nextPost.description ?? "",
            slug: String(nextPost.slug || "").trim(),
            content: nextPost.content ?? "",
            published: Boolean(nextPost.published),
            [passwordFieldKey]: nextPasswordValue,
            usePassword: Boolean(nextPost.usePassword),
            layout: nextPost.layout ?? null,
            selectedTermsByTaxonomy: nextSelectedTermsByTaxonomy,
            categoryIds: nextSelectedTermsByTaxonomy.category ?? [],
            tagIds: nextSelectedTermsByTaxonomy.tag ?? [],
            taxonomyIds: getAllSelectedTaxonomyIds(nextSelectedTermsByTaxonomy),
            metaEntries: nextMetaEntries,
          });
          // Persisted state reconciliation should not immediately re-dirty the editor.
          skipNextAutosaveRef.current = true;
          dataRef.current = nextPost;
          setData(nextPost);
          titleValueRef.current = nextPost.title ?? "";
          descriptionValueRef.current = nextPost.description ?? "";
          slugValueRef.current = String(nextPost.slug || "").trim();
          selectedTermsByTaxonomyRef.current = nextSelectedTermsByTaxonomy;
          setSelectedTermsByTaxonomy(nextSelectedTermsByTaxonomy);
          applyTermNameByIdUpdate(nextTermNameById);
          metaEntriesRef.current = nextMetaEntries;
          setMetaEntries(nextMetaEntries);
          lastSavedSignatureRef.current = nextSignature;
          lastQueuedSignatureRef.current = nextSignature;
          draftShellMaterializedRef.current = true;
          if (preserveNewerLocalDraft) {
            hasUserMutationSinceServerStateRef.current = true;
            writeEditorSessionCache(
              payload.id,
              {
                id: payload.id,
                title: nextPost.title ?? "",
                description: nextPost.description ?? "",
                slug: String(nextPost.slug || "").trim(),
                content: nextPost.content ?? "",
                published: Boolean(nextPost.published),
                [POST_PASSWORD_KEY]: nextPost.password ?? "",
                usePassword: Boolean(nextPost.usePassword),
                layout: nextPost.layout ?? null,
                selectedTermsByTaxonomy: nextSelectedTermsByTaxonomy,
                termNameById: nextTermNameById,
                categoryIds: nextSelectedTermsByTaxonomy.category ?? [],
                tagIds: nextSelectedTermsByTaxonomy.tag ?? [],
                taxonomyIds: getAllSelectedTaxonomyIds(nextSelectedTermsByTaxonomy),
                metaEntries: nextMetaEntries,
              },
              nextSignature,
              true,
            );
          } else {
            hasUserMutationSinceServerStateRef.current = false;
            lastPersistedUserMutationSequenceRef.current = payload.userMutationSequence;
            clearEditorSessionCache(payload.id);
            lastLocalMutationAtRef.current = 0;
            lastUserIntentAtRef.current = 0;
            lastEditorGestureAtRef.current = 0;
            lastAutosaveRevisionRef.current = 0;
            resetInteractionArm("saveQueue:onSaved");
            resetUserMutationSequence(payload.userMutationSequence);
            lastFieldGestureAtRef.current = {
              title: 0,
              description: 0,
              slug: 0,
              password: 0,
              layout: 0,
              usePassword: 0,
              useComments: 0,
            };
            setDirtyRevision(0);
          }
          if (typeof window !== "undefined") {
            const currentUrl = new URL(window.location.href);
            if (currentUrl.searchParams.get("new") === "1") {
              currentUrl.searchParams.delete("new");
              const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
              window.history.replaceState(window.history.state, "", nextPath || currentUrl.pathname);
            }
          }
          return result;
        },
        onStatus: ({ status, error }) => {
          recordEditorDebugEvent("saveQueueStatus", {
            status,
            error: error instanceof Error ? error.message : error ? String(error) : null,
          });
          setSaveStatus(status);
          setSaveError(error instanceof Error ? error.message : error ? String(error) : null);
          if (status === "saved") {
            setSaveRevision((revision) => revision + 1);
          }
        },
      }),
    [autosaveEndpoint, onSave],
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
    if (!editor) return normalizeEditorJsonContent(parseInitialContent(dataRef.current.content));

    if (editorMode === "html-css-first" && htmlDirtyRef.current) {
      editor.commands.setContent(htmlDraftRef.current || "", false);
      htmlDirtyRef.current = false;
    }

    return normalizeEditorJsonContent(editor.getJSON());
  };

  const buildSaveSnapshot = (snapshot?: EditorSaveSnapshot) => {
    if (!canEdit) return;
    const latest = snapshot?.data ?? dataRef.current ?? data;
    const selectedTerms = normalizeSelectedTermsByTaxonomy(
      snapshot?.selectedTermsByTaxonomy ?? selectedTermsByTaxonomyRef.current,
    );
    const nextMetaEntries = normalizeMetaEntriesForPersistence(snapshot?.metaEntries ?? metaEntriesRef.current);
    const nextTitle = titleValueRef.current;
    const nextDescription = descriptionValueRef.current;
    const nextSlug = normalizeSeoSlug(slugValueRef.current || latest.slug || "");
    const content =
      snapshot?.content ??
      (() => {
        const json = getContentJSON();
        return JSON.stringify(json);
      })();
      const signature = buildEditorSaveSignature({
      id: latest.id,
      title: nextTitle,
      description: nextDescription,
      slug: nextSlug,
      content,
      published: Boolean(latest.published),
      password: latest.password ?? "",
      usePassword: Boolean(latest.usePassword),
      layout: latest.layout ?? null,
      selectedTermsByTaxonomy: selectedTerms,
      categoryIds: selectedTerms.category ?? [],
      tagIds: selectedTerms.tag ?? [],
      taxonomyIds: getAllSelectedTaxonomyIds(selectedTerms),
      metaEntries: nextMetaEntries,
    });

    return {
      payload: {
        id: latest.id,
        siteId: latest.siteId ?? null,
        dataDomainKey: latest.dataDomainKey ?? null,
        title: nextTitle,
        description: nextDescription,
        slug: nextSlug,
        content,
        password: latest.password ?? "",
        usePassword: Boolean(latest.usePassword),
        layout: latest.layout ?? null,
        selectedTermsByTaxonomy: selectedTerms,
        categoryIds: selectedTerms.category ?? [],
        tagIds: selectedTerms.tag ?? [],
        taxonomyIds: getAllSelectedTaxonomyIds(selectedTerms),
        metaEntries: nextMetaEntries,
        signature,
        userMutationSequence: snapshot?.userMutationSequence ?? latestUserMutationSequenceRef.current,
      },
      signature,
    };
  };

  const enqueueSave = (immediate = false, snapshot?: EditorSaveSnapshot) => {
    if (!canEdit) return;
    const built = buildSaveSnapshot(snapshot);
    if (!built) return;
    const { payload, signature } = built;
    const effectiveImmediate =
      immediate || (materializeDraftOnFirstSave && !draftShellMaterializedRef.current);

    if (!effectiveImmediate && signature === lastQueuedSignatureRef.current) {
      recordEditorDebugEvent("enqueueSaveSkipped", { reason: "matchesLastQueued", immediate: effectiveImmediate });
      return;
    }
    if (!effectiveImmediate && signature === lastSavedSignatureRef.current) {
      recordEditorDebugEvent("enqueueSaveSkipped", { reason: "matchesLastSaved", immediate: effectiveImmediate });
      return;
    }
    recordEditorDebugEvent("enqueueSave", {
      immediate: effectiveImmediate,
      title: payload.title,
      slug: payload.slug,
      contentLength: payload.content.length,
      metaCount: payload.metaEntries.length,
      taxonomyIds: payload.taxonomyIds,
      userMutationSequence: payload.userMutationSequence,
    });
    lastQueuedSignatureRef.current = signature;
    lastLocalMutationAtRef.current = Date.now();
    writeEditorSessionCache(
      payload.id,
      {
        id: payload.id,
        title: payload.title,
        description: payload.description,
        slug: payload.slug,
        content: payload.content,
        published: Boolean(dataRef.current.published),
        [POST_PASSWORD_KEY]: payload.password,
        usePassword: payload.usePassword,
        layout: payload.layout,
        selectedTermsByTaxonomy: payload.selectedTermsByTaxonomy,
        termNameById: termNameByIdRef.current,
        categoryIds: payload.categoryIds,
        tagIds: payload.tagIds,
        taxonomyIds: payload.taxonomyIds,
        metaEntries: payload.metaEntries,
      },
      signature,
      true,
    );
    saveQueue.enqueue(payload, { immediate: effectiveImmediate });
  };

  const syncEditorSessionSnapshot = (nextPost: PostWithSite, nextMetaEntries: PostMetaEntry[]) => {
    const nextSelectedTermsByTaxonomy = normalizeSelectedTermsByTaxonomy(selectedTermsByTaxonomyRef.current);
    const nextContent = getContentJSON();
    const nextSignature = buildEditorStateSignature({
      post: nextPost,
      content: nextContent,
      selectedTermsByTaxonomy: nextSelectedTermsByTaxonomy,
      metaEntries: nextMetaEntries,
    });
    clearEditorSessionCache(nextPost.id);
    lastSavedSignatureRef.current = nextSignature;
    lastQueuedSignatureRef.current = nextSignature;
    hasUserMutationSinceServerStateRef.current = false;
    lastLocalMutationAtRef.current = 0;
    lastUserIntentAtRef.current = 0;
    lastEditorGestureAtRef.current = 0;
    lastAutosaveRevisionRef.current = 0;
    resetInteractionArm("syncEditorSessionSnapshot");
    resetUserMutationSequence();
    lastFieldGestureAtRef.current = {
      title: 0,
      description: 0,
      slug: 0,
      password: 0,
      layout: 0,
      usePassword: 0,
      useComments: 0,
    };
    setDirtyRevision(0);
  };

  const waitForPendingTaxonomyWrites = async () => {
    while (pendingTaxonomyTasksRef.current.size > 0) {
      await Promise.allSettled(Array.from(pendingTaxonomyTasksRef.current));
    }
  };

  const persistSnapshotNow = async (snapshot?: EditorSaveSnapshot) => {
    if (!canEdit) return false;
    const built = buildSaveSnapshot(snapshot);
    if (!built) return false;
    const { payload, signature } = built;
    if (signature === lastSavedSignatureRef.current) {
      lastPersistedUserMutationSequenceRef.current = payload.userMutationSequence;
      setSaveStatus("saved");
      setSaveError(null);
      return true;
    }
    const previousCachedEditorState = readEditorSessionCache(payload.id);

    lastQueuedSignatureRef.current = signature;
    lastLocalMutationAtRef.current = Date.now();
    setSaveStatus("saving");
    setSaveError(null);
    writeEditorSessionCache(
      payload.id,
      {
        id: payload.id,
        title: payload.title,
        description: payload.description,
        slug: payload.slug,
        content: payload.content,
        published: Boolean(dataRef.current.published),
        [POST_PASSWORD_KEY]: payload.password,
        usePassword: payload.usePassword,
        layout: payload.layout,
        selectedTermsByTaxonomy: payload.selectedTermsByTaxonomy,
        termNameById: termNameByIdRef.current,
        categoryIds: payload.categoryIds,
        tagIds: payload.tagIds,
        taxonomyIds: payload.taxonomyIds,
        metaEntries: payload.metaEntries,
      },
      signature,
      true,
    );
    saveQueue.enqueue(payload, { immediate: true });
    try {
      await saveQueue.flush();
      return true;
    } catch {
      if (previousCachedEditorState) {
        writeEditorSessionCache(
          payload.id,
          previousCachedEditorState.payload,
          previousCachedEditorState.signature,
        );
      } else {
        clearEditorSessionCache(payload.id);
      }
      return false;
    }
  };

  const saveNow = async () => {
    if (!canEdit) return false;
    await waitForPendingTaxonomyWrites();
    return persistSnapshotNow();
  };

  const hasRecentUserIntent = (now = Date.now()) =>
    lastUserIntentAtRef.current > 0 && now - lastUserIntentAtRef.current <= EDITOR_USER_INTENT_WINDOW_MS;

  const resetInteractionArm = (reason = "unknown") => {
    interactionArmedByUserRef.current = materializeDraftOnFirstSave;
    recordEditorDebugEvent("editorInteractionReset", {
      reason,
      armed: interactionArmedByUserRef.current,
      materializeDraftOnFirstSave,
    });
  };

  const markUserIntent = () => {
    lastUserIntentAtRef.current = Date.now();
  };

  const armInteractionForMutation = (reason = "unknown") => {
    markUserIntent();
    interactionArmedByUserRef.current = true;
    recordEditorDebugEvent("editorInteractionArmed", {
      reason,
      materializeDraftOnFirstSave,
    });
  };

  const markLocalDirty = (
    reason = "unknown",
    snapshot?: EditorSaveSnapshot,
    options?: { requireRecentUserIntent?: boolean; userMutation?: boolean },
  ) => {
    if (!canEdit) return;
    const built = buildSaveSnapshot(snapshot);
    if (!built) return;
    const requireRecentUserIntent = options?.requireRecentUserIntent !== false;
    if (
      !shouldMarkEditorStateDirty({
        nextSignature: built.signature,
        lastSavedSignature: lastSavedSignatureRef.current,
      })
    ) {
      setSaveError(null);
      setSaveStatus("saved");
      recordEditorDebugEvent("markLocalDirtySkipped", {
        reason,
        cause: "matchesLastSavedSignature",
      });
      return;
    }
    if (options?.userMutation === true && !materializeDraftOnFirstSave && !interactionArmedByUserRef.current) {
      recordEditorDebugEvent("markLocalDirtySkipped", {
        reason,
        cause: "inactiveEditorSession",
      });
      return;
    }
    if (requireRecentUserIntent && !hasRecentUserIntent()) {
      recordEditorDebugEvent("markLocalDirtySkipped", {
        reason,
        cause: "missingRecentUserIntent",
      });
      return;
    }
    let userMutationSequence = latestUserMutationSequenceRef.current;
    if (options?.userMutation === true) {
      hasUserMutationSinceServerStateRef.current = true;
      userMutationSequence = recordUserMutationSequence();
    }
    lastLocalMutationAtRef.current = Date.now();
    setSaveError(null);
    setSaveStatus("unsaved");
    setDirtyRevision((revision) => revision + 1);
    recordEditorDebugEvent("markLocalDirty", { reason, userMutationSequence });
  };

  const markEditorGesture = () => {
    armInteractionForMutation("editorGesture");
    lastEditorGestureAtRef.current = Date.now();
  };

  const markFieldGesture = (field: EditorFieldGestureKey) => {
    armInteractionForMutation(`fieldGesture:${field}`);
    lastFieldGestureAtRef.current[field] = Date.now();
  };

  const markTextFieldGesture = (field: "title" | "description" | "slug" | "password") => {
    markFieldGesture(field);
  };

  const fieldIsFocused = (element: Element | null) =>
    typeof document !== "undefined" && Boolean(element) && document.activeElement === element;

  const exec = (fn: (editor: EditorInstance) => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    markEditorGesture();
    fn(editor);
    editor.commands.focus();
  };

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    const editor = editorRef.current;
    if (!editor) return false;
    return editor.isActive(name as any, attrs as any);
  };

  const getTermsForTaxonomy = (taxonomy: string) => taxonomyTermsByKey[taxonomy] ?? [];
  const setTaxonomyInputValue = (taxonomy: string, value: string) => {
    taxonomyInputByKeyRef.current = { ...taxonomyInputByKeyRef.current, [taxonomy]: value };
    setTaxonomyInputByKey((prev) => ({ ...prev, [taxonomy]: value }));
  };
  const readTaxonomyInputValue = (taxonomy: string) =>
    taxonomyInputRefs.current[taxonomy]?.value ?? taxonomyInputByKeyRef.current[taxonomy] ?? "";
  const selectSidebarTab = (tabId: string) => {
    const normalizedTabId = String(tabId || "").trim();
    if (!normalizedTabId) return;
    writeEditorSidebarTab(post.id, normalizedTabId);
    setSidebarTab(normalizedTabId);
  };

  const updateSelectedTermsByTaxonomy = (
    updater:
      | Record<string, number[]>
      | ((prev: Record<string, number[]>) => Record<string, number[]>),
  ) => {
    armInteractionForMutation("taxonomySelection");
    const prev = selectedTermsByTaxonomyRef.current;
    const next = normalizeSelectedTermsByTaxonomy(typeof updater === "function" ? updater(prev) : updater);
    selectedTermsByTaxonomyRef.current = next;
    setSelectedTermsByTaxonomy(next);
    markLocalDirty(
      "updateSelectedTermsByTaxonomy",
      { selectedTermsByTaxonomy: next },
      { userMutation: true },
    );
    return next;
  };

  const persistSelectedTermsByTaxonomy = (nextSelectedTermsByTaxonomy: Record<string, number[]>) => {
    // Taxonomy writes should persist directly onto the current article record,
    // regardless of whether the item is still a temporary draft shell.
    void persistSnapshotNow({ selectedTermsByTaxonomy: nextSelectedTermsByTaxonomy });
  };

  const toggleTaxonomyTerm = (taxonomy: string, termId: number) => {
    if (!canEdit) return;
    const nextSelectedTermsByTaxonomy = updateSelectedTermsByTaxonomy((prev) => {
      const current = prev[taxonomy] ?? [];
      const next = current.includes(termId)
        ? current.filter((id) => id !== termId)
        : [...current, termId];
      return { ...prev, [taxonomy]: next };
    });
    persistSelectedTermsByTaxonomy(nextSelectedTermsByTaxonomy);
  };

  const loadAllTermsForTaxonomy = async (taxonomy: string) => {
    if (taxonomyExpanded[taxonomy]) return;
    const siteId = String(post.siteId || "").trim();
    if (!siteId) return;
    if (isEagerEditorTaxonomy(taxonomy)) {
      setTaxonomyLoadStateByKey((prev) => ({ ...prev, [taxonomy]: "loaded" }));
      setTaxonomyAutoloadStateByKey((prev) => ({ ...prev, [taxonomy]: "settled" }));
      setTaxonomyExpanded((prev) => ({ ...prev, [taxonomy]: true }));
      return;
    }
    setTaxonomyLoadStateByKey((prev) => ({ ...prev, [taxonomy]: "loading" }));
    setTaxonomyLoadingMore((prev) => ({ ...prev, [taxonomy]: true }));
    try {
      const normalized = await runWithEditorTaxonomyReferenceCache(
        {
          siteId,
          taxonomy,
        },
        () =>
          fetchTaxonomyTermsForEditor({
            siteId,
            taxonomy,
          }),
      );
      setTaxonomyTermsByKey((prev) => ({ ...prev, [taxonomy]: normalized }));
      setTaxonomyLoadStateByKey((prev) => ({ ...prev, [taxonomy]: "loaded" }));
      applyTermNameByIdUpdate((prev) => {
        const next = { ...prev };
        for (const term of normalized) next[term.id] = term.name;
        return next;
      });
      setTaxonomyExpanded((prev) => ({ ...prev, [taxonomy]: true }));
    } catch (error) {
      setTaxonomyLoadStateByKey((prev) => ({ ...prev, [taxonomy]: "error" }));
      throw error;
    } finally {
      setTaxonomyLoadingMore((prev) => ({ ...prev, [taxonomy]: false }));
    }
  };

  const addOrSelectTaxonomyTerm = async (taxonomy: string, rawName: string) => {
    if (!canEdit) return;
    if (!post.siteId) return;
    const siteId = post.siteId;
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const requestKey = `${taxonomy}:${trimmed.toLowerCase()}`;
    if (pendingTaxonomyRequestKeysRef.current.has(requestKey)) return;
    pendingTaxonomyRequestKeysRef.current.add(requestKey);
    const task = (async () => {
      setPendingTaxonomyWrites((prev) => ({ ...prev, [taxonomy]: (prev[taxonomy] ?? 0) + 1 }));
      try {
        const existing = getTermsForTaxonomy(taxonomy).find(
          (term) => term.name.toLowerCase() === trimmed.toLowerCase(),
        );
        let termId: number | null = existing?.id ?? null;
        if (existing && !termNameByIdRef.current[existing.id]) {
          applyTermNameByIdUpdate((prev) => ({ ...prev, [existing.id]: existing.name }));
        }
        if (termId === null) {
          const created = await createTaxonomyTerm({ siteId, taxonomy, label: trimmed });
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
            applyTermNameByIdUpdate((prev) => ({ ...prev, [resolvedTermId]: termName }));
          }
        }
        if (termId === null) return;
        const selectedTermId = termId;
        const nextSelectedTermsByTaxonomy = updateSelectedTermsByTaxonomy((prev) => {
          const current = prev[taxonomy] ?? [];
          if (current.includes(selectedTermId)) return prev;
          return { ...prev, [taxonomy]: [...current, selectedTermId] };
        });
        setTaxonomyInputValue(taxonomy, "");
        persistSelectedTermsByTaxonomy(nextSelectedTermsByTaxonomy);
      } finally {
        pendingTaxonomyRequestKeysRef.current.delete(requestKey);
        setPendingTaxonomyWrites((prev) => {
          const nextCount = Math.max(0, (prev[taxonomy] ?? 0) - 1);
          return nextCount > 0 ? { ...prev, [taxonomy]: nextCount } : Object.fromEntries(Object.entries(prev).filter(([key]) => key !== taxonomy));
        });
      }
    })();
    pendingTaxonomyTasksRef.current.add(task);
    void task.finally(() => {
      pendingTaxonomyTasksRef.current.delete(task);
    });
  };

  const addMetaEntry = (key: string, value: string) => {
    if (!canEdit) return;
    const nextKey = key.trim();
    if (!nextKey) return;
    armInteractionForMutation("meta:addOrUpdate");
    const nextMetaEntries = normalizeMetaEntriesForPersistence(
      upsertEditorMetaEntry(metaEntriesRef.current, nextKey, value),
    );
    metaEntriesRef.current = nextMetaEntries;
    setMetaEntries(nextMetaEntries);
    setMetaKeySuggestions((prev) => (prev.includes(nextKey) ? prev : [...prev, nextKey].sort((a, b) => a.localeCompare(b))));
    setMetaKeyInput("");
    setMetaValueInput("");
    enqueueSave(true, { metaEntries: nextMetaEntries });
  };

  const applyMetaEntriesUpdate = (nextMetaEntries: PostMetaEntry[], immediate = true) => {
    armInteractionForMutation("meta:apply");
    const normalizedEntries = normalizeMetaEntriesForPersistence(nextMetaEntries);
    metaEntriesRef.current = normalizedEntries;
    setMetaEntries(normalizedEntries);
    enqueueSave(immediate, { metaEntries: normalizedEntries });
  };

  const visibleMetaEntries = useMemo(() => filterVisibleEditorMetaEntries(metaEntries), [metaEntries]);
  const passwordFieldKey = "password" as const;
  const scheduledPublishAt = useMemo(
    () => readHiddenMetaValue(metaEntries, HIDDEN_PUBLISH_AT_META_KEY),
    [metaEntries],
  );
  const deleteConfirmationTarget = useMemo(() => {
    const title = String(data.title || "").trim();
    return title || "delete";
  }, [data.title]);
  const deleteConfirmationMatches = useMemo(() => {
    const typed = deleteConfirmation.trim();
    if (deleteConfirmationTarget === "delete") {
      return typed.toLowerCase() === "delete";
    }
    return typed === deleteConfirmationTarget;
  }, [deleteConfirmation, deleteConfirmationTarget]);

  const handleTitleInput = (value: string, nativeEvent?: Event | null) => {
    const current = dataRef.current;
    const currentValue = titleValueRef.current ?? current.title ?? "";
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorTextFieldMutation({
        currentValue,
        nextValue: value,
        recentGestureAt: lastFieldGestureAtRef.current.title,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(titleInputRef.current),
      })
    ) {
      return;
    }
    titleValueRef.current = value;
    const nextData = { ...current, title: value };
    applyDataUpdate(nextData, { markDirty: true, reason: "field:title", userMutation: true });
  };

  const handleDescriptionInput = (value: string, nativeEvent?: Event | null) => {
    const current = dataRef.current;
    const currentValue = descriptionValueRef.current ?? current.description ?? "";
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorTextFieldMutation({
        currentValue,
        nextValue: value,
        recentGestureAt: lastFieldGestureAtRef.current.description,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(descriptionInputRef.current),
      })
    ) {
      return;
    }
    descriptionValueRef.current = value;
    applyDataUpdate((prev) => ({ ...prev, description: value }), {
      markDirty: true,
      reason: "field:description",
      userMutation: true,
    });
  };

  const handleSlugDraftInput = (value: string, nativeEvent?: Event | null) => {
    const nextSlugDraft = normalizeSlugDraft(value);
    const current = dataRef.current;
    const currentValue = slugValueRef.current || current.slug || "";
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorTextFieldMutation({
        currentValue,
        nextValue: nextSlugDraft,
        recentGestureAt: lastFieldGestureAtRef.current.slug,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(slugInputRef.current),
      })
    ) {
      return;
    }
    slugValueRef.current = nextSlugDraft;
    applyDataUpdate((prev) => ({ ...prev, slug: nextSlugDraft }), {
      markDirty: true,
      reason: "field:slug:draft",
      userMutation: true,
    });
  };

  const handleSlugCommit = (value: string, nativeEvent?: Event | null) => {
    const nextSlug = normalizeSeoSlug(value);
    const current = dataRef.current;
    const currentValue = normalizeSeoSlug(slugValueRef.current || current.slug || "");
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorTextFieldCommit({
        currentValue,
        nextValue: nextSlug,
        recentGestureAt: lastFieldGestureAtRef.current.slug,
        trusted: meta.trusted,
      })
    ) {
      return;
    }
    slugValueRef.current = nextSlug;
    applyDataUpdate((current) => ({ ...current, slug: nextSlug }), {
      markDirty: true,
      reason: "field:slug:commit",
      userMutation: true,
    });
  };

  const handlePasswordInput = (value: string, nativeEvent?: Event | null) => {
    const currentValue = dataRef.current.password ?? "";
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorTextFieldMutation({
        currentValue,
        nextValue: value,
        recentGestureAt: lastFieldGestureAtRef.current.password,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(passwordInputRef.current),
      })
    ) {
      return;
    }
    applyDataUpdate((prev) => ({ ...prev, password: value }), {
      markDirty: true,
      reason: "field:password",
      userMutation: true,
    });
  };

  const handleLayoutChange = (value: string, nativeEvent?: Event | null) => {
    const currentValue = dataRef.current.layout ?? "post";
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorFieldMutation({
        currentValue,
        nextValue: value,
        recentGestureAt: lastFieldGestureAtRef.current.layout,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(layoutSelectRef.current),
      })
    ) {
      return;
    }
    applyDataUpdate((prev) => ({ ...prev, layout: value }), {
      markDirty: true,
      reason: "field:layout",
      userMutation: true,
    });
  };

  const handleUsePasswordChange = (enabled: boolean, nativeEvent?: Event | null) => {
    const currentValue = Boolean(dataRef.current.usePassword);
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorFieldMutation({
        currentValue,
        nextValue: enabled,
        recentGestureAt: lastFieldGestureAtRef.current.usePassword,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(usePasswordCheckboxRef.current),
      })
    ) {
      return;
    }
    applyDataUpdate((prev) => ({ ...prev, usePassword: enabled }), {
      markDirty: true,
      reason: "field:usePassword",
      userMutation: true,
    });
    if (!enabled) {
      setShowPostPassword(false);
    }
  };

  const useComments = readMetaBoolean(metaEntries, "use_comments", defaultEnableComments);
  const publishButtonLabel = data.published ? "Unpublish" : "Publish";
  const scheduleButtonLabel = formatScheduledPublishLabel(scheduledPublishAt);
  const scheduleButtonAriaLabel = scheduleButtonLabel.replace(/^Publish:/, "Schedule publish:");
  const selectedTermsDigest = useMemo(
    () => JSON.stringify(normalizeSelectedTermsByTaxonomy(selectedTermsByTaxonomy)),
    [selectedTermsByTaxonomy],
  );
  const metaEntriesDigest = useMemo(
    () => JSON.stringify(normalizeMetaEntriesForPersistence(metaEntries)),
    [metaEntries],
  );
  const isExplicitEditorActionPending =
    isPendingPublishAction || isPendingPublishSchedule || isPendingThumbnail || isPendingDelete;

  const setUseComments = (enabled: boolean, nativeEvent?: Event | null) => {
    if (!canEdit) return;
    const meta = readEditorTextInputMeta(nativeEvent);
    if (
      !shouldAcceptEditorFieldMutation({
        currentValue: useComments,
        nextValue: enabled,
        recentGestureAt: lastFieldGestureAtRef.current.useComments,
        trusted: meta.trusted,
        fieldFocused: fieldIsFocused(useCommentsCheckboxRef.current),
      })
    ) {
      return;
    }
    const nextValue = enabled ? "true" : "false";
    const nextMetaEntries = (() => {
      const next = [...metaEntriesRef.current];
      const index = next.findIndex((entry) => entry.key.toLowerCase() === "use_comments");
      if (index >= 0) {
        next[index] = { key: "use_comments", value: nextValue };
        return next;
      }
      return [...next, { key: "use_comments", value: nextValue }];
    })();
    metaEntriesRef.current = nextMetaEntries;
    setMetaEntries(nextMetaEntries);
    enqueueSave(true, { metaEntries: nextMetaEntries });
  };

  useEffect(() => {
    if (!canEdit) return;
    if (dirtyRevision <= 0) return;
    if (saveStatus !== "unsaved") return;
    if (!materializeDraftOnFirstSave && !interactionArmedByUserRef.current) {
      recordEditorDebugEvent("autosaveSkipped", { reason: "inactiveEditorSession" });
      lastAutosaveRevisionRef.current = dirtyRevision;
      setSaveError(null);
      setSaveStatus("saved");
      return;
    }
    if (latestUserMutationSequenceRef.current <= lastPersistedUserMutationSequenceRef.current) {
      recordEditorDebugEvent("autosaveSkipped", {
        reason: "noNewUserMutationSequence",
        latestUserMutationSequence: latestUserMutationSequenceRef.current,
        lastPersistedUserMutationSequence: lastPersistedUserMutationSequenceRef.current,
      });
      lastAutosaveRevisionRef.current = dirtyRevision;
      setSaveError(null);
      setSaveStatus("saved");
      return;
    }
    if (!hasUserMutationSinceServerStateRef.current) {
      recordEditorDebugEvent("autosaveSkipped", { reason: "missingUserMutationSinceServerState" });
      lastAutosaveRevisionRef.current = dirtyRevision;
      setSaveError(null);
      setSaveStatus("saved");
      return;
    }
    if (!hasRecentUserIntent()) {
      recordEditorDebugEvent("autosaveSkipped", { reason: "missingRecentUserIntent" });
      lastAutosaveRevisionRef.current = dirtyRevision;
      setSaveError(null);
      setSaveStatus("saved");
      return;
    }
    if (skipNextAutosaveRef.current) {
      recordEditorDebugEvent("autosaveSkipped", { reason: "skipNextAutosaveRef" });
      skipNextAutosaveRef.current = false;
      lastAutosaveRevisionRef.current = dirtyRevision;
      return;
    }
    if (lastAutosaveRevisionRef.current === dirtyRevision) return;
    recordEditorDebugEvent("autosaveEffect", {
      dirtyRevision,
      title: data.title,
      slug: data.slug,
      saveStatus,
      latestUserMutationSequence: latestUserMutationSequenceRef.current,
      lastPersistedUserMutationSequence: lastPersistedUserMutationSequenceRef.current,
    });
    lastAutosaveRevisionRef.current = dirtyRevision;
    enqueueSave(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, dirtyRevision, saveStatus]);

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

  const saveScheduledPublishAt = (nextValue: string) => {
    if (!canEdit) return;
    const normalized = toScheduledPublishIso(nextValue);
    if (nextValue.trim() && !normalized) {
      toast.error("Enter a valid scheduled publish date and time.");
      return;
    }
    const previousMetaEntries = metaEntriesRef.current;
    const optimisticMetaEntries = normalized
      ? [
          ...previousMetaEntries.filter((entry) => entry.key !== HIDDEN_PUBLISH_AT_META_KEY),
          { key: HIDDEN_PUBLISH_AT_META_KEY, value: normalized },
        ]
      : previousMetaEntries.filter((entry) => entry.key !== HIDDEN_PUBLISH_AT_META_KEY);
    skipNextAutosaveRef.current = true;
    metaEntriesRef.current = optimisticMetaEntries;
    setMetaEntries(optimisticMetaEntries);
    setPublishScheduleDialogOpen(false);
    startTransitionPublishSchedule(async () => {
      try {
        const persisted = await saveNow();
        if (!persisted) {
          throw new Error("Save your entry successfully before updating the publish schedule.");
        }
        const formData = new FormData();
        formData.append("publishAt", normalized ?? "");
        const response = await onUpdateMetadata(formData, post.id, HIDDEN_PUBLISH_AT_META_KEY);
        if ((response as any)?.error) {
          throw new Error(String((response as any).error));
        }
        const nextPublishAt =
          typeof (response as any)?.publishAt === "string" && String((response as any).publishAt).trim()
            ? String((response as any).publishAt).trim()
            : null;
        const nextPublished =
          typeof (response as any)?.published === "boolean"
            ? Boolean((response as any).published)
            : Boolean(dataRef.current.published);
        const nextMetaEntries = (() => {
          const filtered = metaEntriesRef.current.filter((entry) => entry.key !== HIDDEN_PUBLISH_AT_META_KEY);
          return nextPublishAt
            ? [...filtered, { key: HIDDEN_PUBLISH_AT_META_KEY, value: nextPublishAt }]
            : filtered;
        })();
        skipNextAutosaveRef.current = true;
        metaEntriesRef.current = nextMetaEntries;
        setMetaEntries(nextMetaEntries);
        const nextPost = { ...dataRef.current, published: nextPublished };
        applyDataUpdate(nextPost);
        syncEditorSessionSnapshot(nextPost, nextMetaEntries);
        toast.success(normalized ? "Scheduled publish time updated." : "Scheduled publish cleared.");
      } catch (error) {
        skipNextAutosaveRef.current = true;
        metaEntriesRef.current = previousMetaEntries;
        setMetaEntries(previousMetaEntries);
        toast.error(error instanceof Error ? error.message : "Failed to update scheduled publish.");
      }
    });
  };

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
        applyDataUpdate((prev) => ({ ...prev, image: uploaded.url }));
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
        applyDataUpdate((prev) => ({ ...prev, image: item.url }));
        toast.success("Thumbnail updated from media manager.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to set thumbnail.");
      }
    });
  };

  const activeSidebarTab = editorSidebarTabs.find((tab) => tab.id === sidebarTab) || editorSidebarTabs[0] || null;
  const cycleSidebarTab = (direction: -1 | 1) => {
    if (editorSidebarTabs.length <= 1) return;
    const currentIndex = Math.max(
      0,
      editorSidebarTabs.findIndex((tab) => tab.id === (activeSidebarTab?.id || editorSidebarTabs[0]?.id)),
    );
    const nextIndex = (currentIndex + direction + editorSidebarTabs.length) % editorSidebarTabs.length;
    selectSidebarTab(editorSidebarTabs[nextIndex]?.id || editorSidebarTabs[0]?.id || "document");
  };
  const handleSidebarTabListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      cycleSidebarTab(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      cycleSidebarTab(-1);
    }
  };

  if (!initialContent) return null;

  return (
    <div
      className="grid w-full max-w-[1400px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
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
              <div
                className="rounded-lg bg-accent px-2 py-1 text-sm text-muted-foreground"
                data-editor-save-status={saveStatus}
                data-editor-save-revision={saveRevision}
              >
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
            <Dialog open={publishScheduleDialogOpen} onOpenChange={setPublishScheduleDialogOpen}>
              {!data.published ? (
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-100",
                      isExplicitEditorActionPending ? "cursor-not-allowed opacity-60" : "",
                    )}
                    aria-label={scheduleButtonAriaLabel}
                    disabled={isExplicitEditorActionPending}
                    onClick={() => {
                      setPublishScheduleDraft(toDateTimeLocalInputValue(scheduledPublishAt));
                    }}
                  >
                    {scheduleButtonLabel}
                  </button>
                </DialogTrigger>
              ) : null}

              <DialogContent className="max-w-md border-stone-200 bg-white text-stone-900 shadow-2xl">
                <DialogHeader>
                  <DialogTitle>Schedule publish</DialogTitle>
                  <DialogDescription>
                    Choose a future publish date and time. This does not publish the entry by itself. You still need to click Publish.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Publish at</span>
                    <input
                      type="datetime-local"
                      value={publishScheduleDraft}
                      onChange={(event) => setPublishScheduleDraft(event.target.value)}
                      className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                    />
                  </label>
                  <p className="text-xs text-stone-500">
                    Leave this empty to publish immediately when you click Publish.
                  </p>
                </div>
                <DialogFooter>
                  <button
                    type="button"
                    className="rounded-md border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
                    onClick={() => setPublishScheduleDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100"
                    onClick={() => setPublishScheduleDraft("")}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={isPendingPublishSchedule}
                    className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => saveScheduledPublishAt(publishScheduleDraft)}
                  >
                    {isPendingPublishSchedule ? "Saving..." : "Save Schedule"}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

              <button
              type="button"
              onClick={() => {
                if (!canPublish) return;
                startTransitionPublishAction(async () => {
                  try {
                    const persisted = await saveNow();
                    if (!persisted) {
                      throw new Error("Save your entry successfully before changing publish status.");
                    }
                    const formData = new FormData();
                    formData.append("published", String(!data.published));
                    const response = await onUpdateMetadata(formData, post.id, "published");
                    if ((response as any)?.error) {
                      throw new Error(String((response as any).error));
                    }
                    const nextPublished =
                      typeof (response as any)?.published === "boolean"
                        ? Boolean((response as any).published)
                        : !data.published;
                    const nextPublishAt =
                      typeof (response as any)?.publishAt === "string" && String((response as any).publishAt).trim()
                        ? String((response as any).publishAt).trim()
                        : null;
                    const nextMetaEntries = (() => {
                      const filtered = metaEntriesRef.current.filter((entry) => entry.key !== HIDDEN_PUBLISH_AT_META_KEY);
                      return nextPublishAt
                        ? [...filtered, { key: HIDDEN_PUBLISH_AT_META_KEY, value: nextPublishAt }]
                        : filtered;
                    })();
                    metaEntriesRef.current = nextMetaEntries;
                    setMetaEntries(nextMetaEntries);
                    const nextPost = {
                      ...dataRef.current,
                      published: nextPublished,
                    };
                    applyDataUpdate(nextPost);
                    syncEditorSessionSnapshot(nextPost, nextMetaEntries);
                    if ((response as any)?.scheduled) {
                      toast.success(`Scheduled for ${formatScheduledPublishLabel(nextPublishAt).replace(/^Publish: /, "")}.`);
                    } else {
                      toast.success(`Successfully ${data.published ? "unpublished" : "published"} your post.`);
                    }
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to update publish status.");
                  }
                });
              }}
              className={cn(
                "flex h-7 w-24 items-center justify-center space-x-2 rounded-lg border text-sm transition-all focus:outline-none",
                isExplicitEditorActionPending || !canPublish
                  ? "cursor-not-allowed border-muted bg-muted text-muted-foreground"
                  : "border border-black bg-white text-black hover:bg-gray-800 hover:text-white active:bg-muted dark:border-stone-700",
              )}
              disabled={isExplicitEditorActionPending || !canPublish}
              aria-label={publishButtonLabel}
            >
              {isPendingPublishAction || isPendingPublishSchedule ? (
                <>
                  <LoadingDots />
                  <span className="sr-only">{publishButtonLabel}</span>
                </>
              ) : (
                <p>{publishButtonLabel}</p>
              )}
            </button>
          </div>
        </div>

        <div className="mb-5 flex flex-col space-y-3 border-b border-muted pb-5">
          <input
            type="text"
            placeholder="Title"
            value={data.title ?? ""}
            autoFocus={materializeDraftOnFirstSave}
            autoComplete="off"
            ref={titleInputRef}
            onPointerDown={() => markTextFieldGesture("title")}
            onKeyDown={() => markTextFieldGesture("title")}
            onPaste={() => markTextFieldGesture("title")}
            onInput={(e) => handleTitleInput((e.currentTarget as HTMLInputElement).value, e.nativeEvent)}
            readOnly={!canEdit}
            className="border-none bg-background px-0 font-cal text-3xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
          />
          <TextareaAutosize
            placeholder="Description"
            value={data.description ?? ""}
            autoComplete="off"
            ref={descriptionInputRef}
            onPointerDown={() => markTextFieldGesture("description")}
            onKeyDown={() => markTextFieldGesture("description")}
            onPaste={() => markTextFieldGesture("description")}
            onInput={(e) => handleDescriptionInput(e.currentTarget.value, e.nativeEvent)}
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
                autoComplete="off"
                ref={slugInputRef}
                onPointerDown={() => markTextFieldGesture("slug")}
                onKeyDown={() => markTextFieldGesture("slug")}
                onPaste={() => markTextFieldGesture("slug")}
                onInput={(e) => handleSlugDraftInput(e.currentTarget.value, e.nativeEvent)}
                onBlur={(e) => handleSlugCommit(e.currentTarget.value, e.nativeEvent)}
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
              immediatelyRender={false}
              initialContent={initialContent}
              extensions={extensions}
              className="min-h-[900px] w-full bg-background"
              editorProps={{
                handleDOMEvents: {
                  keydown: (_view, event) => {
                    markEditorGesture();
                    return handleCommandNavigation(event);
                  },
                },
                handlePaste: (view, event) => {
                  markEditorGesture();
                  return handleImagePaste(view, event, uploadFn);
                },
                handleDrop: (view, event, _slice, moved) => {
                  markEditorGesture();
                  return handleImageDrop(view, event, moved, uploadFn);
                },
                attributes: {
                  class:
                    "prose prose-lg max-w-full px-6 py-5 font-default text-black focus:outline-none prose-h1:text-black prose-h2:text-black prose-h3:text-black prose-headings:text-black prose-strong:text-black dark:prose-invert",
                },
              }}
              onUpdate={({ editor, transaction }) => {
                editorRef.current = editor;
                setCharsCount(editor.storage.characterCount.words());
                setCurrentBlockMode(getCurrentBlockMode(editor));
                setCurrentTextAlign(getCurrentTextAlign(editor));
                setToolbarTick((v) => v + 1);
                const json = normalizeEditorJsonContent(editor.getJSON());
                const contentSignature = JSON.stringify(json);
                const hadLocalEditorMutation = contentSignature !== lastObservedEditorContentSignatureRef.current;
                lastObservedEditorContentSignatureRef.current = contentSignature;
                const shouldTreatUpdateAsUserEdit =
                  hadLocalEditorMutation &&
                  (Date.now() - lastEditorGestureAtRef.current < 1_500 ||
                    Boolean(transaction?.getMeta?.("paste")) ||
                    Boolean(transaction?.getMeta?.("drop")));
                if (shouldTreatUpdateAsUserEdit) {
                  markLocalDirty("editor:onUpdate", undefined, { userMutation: true });
                  setEditorContentDigest(contentSignature);
                  recordEditorDebugEvent("editorContentChanged", {
                    reason: "editor:onUpdate",
                    contentSignatureLength: contentSignature.length,
                  });
                }
                const imageUrls = Array.from(new Set(collectImageUrlsFromNode(json)));
                setPostImageUrls(imageUrls);
                const imageCount = countImageNodes(json);
                lastImageCountRef.current = imageCount;
              }}
              onCreate={({ editor }) => {
                editorRef.current = editor;
                editor.setEditable(canEdit);
                setCharsCount(editor.storage.characterCount.words());
                setCurrentBlockMode(getCurrentBlockMode(editor));
                setCurrentTextAlign(getCurrentTextAlign(editor));
                setEditorContentDigest(JSON.stringify(normalizeEditorJsonContent(editor.getJSON())));
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
              disabled={isExplicitEditorActionPending}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                isExplicitEditorActionPending
                  ? "cursor-not-allowed bg-stone-300 text-stone-600"
                  : "bg-black text-white hover:bg-stone-800",
              )}
            >
              {isExplicitEditorActionPending ? "Saving..." : "Save Changes"}
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
                  isExplicitEditorActionPending
                    ? "cursor-not-allowed bg-stone-300 text-stone-600"
                    : "bg-black text-white hover:bg-stone-800",
                )}
                onClick={() => void saveNow()}
                disabled={isExplicitEditorActionPending}
              >
                {isExplicitEditorActionPending ? "Saving..." : "Save Changes"}
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

      <aside className={cn("h-fit w-full min-w-0 max-w-full overflow-x-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-sm", !canEdit && "opacity-75")}>
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

        <div className="mt-4 flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 p-1 text-xs">
          <button
            type="button"
            aria-label="Previous editor tab"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
            onClick={() => cycleSidebarTab(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div
            ref={sidebarTabListRef}
            role="tablist"
            aria-label="Editor sidebar tabs"
            onKeyDown={handleSidebarTabListKeyDown}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {editorSidebarTabs.map((tab) => (
              <button
                key={tab.id}
                ref={(node) => {
                  sidebarTabButtonRefs.current[tab.id] = node;
                }}
                type="button"
                role="tab"
                aria-selected={sidebarTab === tab.id}
                className={cn(
                  "shrink-0 rounded px-2 py-1.5",
                  sidebarTab === tab.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white",
                )}
                onClick={() => selectSidebarTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Next editor tab"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
            onClick={() => cycleSidebarTab(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {activeSidebarTab?.id === "document" && (
          <fieldset disabled={!canEdit} className="mt-4 min-w-0 space-y-3">
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

        {activeSidebarTab?.id === "block" && (
          <fieldset disabled={!canEdit} className="mt-4 min-w-0 max-w-full space-y-3 overflow-x-hidden">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Post Settings</div>
            <select
              ref={layoutSelectRef}
              value={data.layout ?? "post"}
              onPointerDown={() => markFieldGesture("layout")}
              onKeyDown={() => markFieldGesture("layout")}
              onChange={(e) => handleLayoutChange(e.target.value, e.nativeEvent)}
              className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900"
            >
              <option value="post">Post Layout (default)</option>
              <option value="page">Page Layout</option>
              <option value="gallery">Gallery Layout (media grid)</option>
            </select>
            <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-2 text-xs text-stone-700">
              <input
                ref={usePasswordCheckboxRef}
                type="checkbox"
                checked={Boolean(data.usePassword)}
                onPointerDown={() => markFieldGesture("usePassword")}
                onKeyDown={() => markFieldGesture("usePassword")}
                onChange={(e) => handleUsePasswordChange(e.target.checked, e.nativeEvent)}
                className="h-4 w-4 accent-black"
              />
              Password Protect
            </label>
            {Boolean(data.usePassword) ? (
              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">
                  Post Password
                </span>
                <div className="flex items-center gap-1">
                  <input
                    ref={passwordInputRef}
                    type={showPostPassword ? "text" : "password"}
                    value={data.password ?? ""}
                    onPointerDown={() => markTextFieldGesture("password")}
                    onKeyDown={() => markTextFieldGesture("password")}
                    onPaste={() => markTextFieldGesture("password")}
                    onInput={(e) => handlePasswordInput(e.currentTarget.value, e.nativeEvent)}
                    placeholder="Enter password"
                    className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPostPassword((prev) => !prev)}
                    className="rounded border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-700 hover:bg-stone-100"
                    aria-label={showPostPassword ? "Hide password" : "Show password"}
                    title={showPostPassword ? "Hide password" : "Show password"}
                  >
                    {showPostPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </label>
            ) : null}
            {commentsPluginEnabled ? (
              <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-2 text-xs text-stone-700">
                <input
                  ref={useCommentsCheckboxRef}
                  type="checkbox"
                  checked={useComments}
                  onPointerDown={() => markFieldGesture("useComments")}
                  onKeyDown={() => markFieldGesture("useComments")}
                  onChange={(e) => setUseComments(e.target.checked, e.nativeEvent)}
                  className="h-4 w-4 accent-black"
                />
                Use comments
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("bulletList") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleBulletList().run())}>Bulleted</button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("orderedList") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleOrderedList().run())}>Numbered</button>
              <button type="button" className={cn("rounded border px-2 py-1 text-xs", isActive("blockquote") ? "bg-stone-900 text-white" : "hover:bg-stone-100")} onClick={() => exec((e) => e.chain().toggleBlockquote().run())}>Quote</button>
            </div>
          </fieldset>
        )}

        {activeSidebarTab?.id === "plugins" && (
          <fieldset disabled={!canEdit} className="mt-4 min-w-0 max-w-full space-y-3 overflow-x-hidden">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Organize</div>
            {taxonomyOverviewRows.map((taxonomyRow) => {
              const taxonomy = taxonomyRow.taxonomy;
              const sectionTerms = getTermsForTaxonomy(taxonomy);
              const selectedTermIds = selectedTermsByTaxonomy[taxonomy] ?? [];
              const selectedTermIdSet = new Set(selectedTermIds);
              const availableTerms = sectionTerms.filter((term) => !selectedTermIdSet.has(term.id));
              const canLoadMoreTerms = shouldAllowManualEditorTaxonomyExpansion({
                taxonomy,
                termCount: taxonomyRow.termCount,
                loadedTermsCount: sectionTerms.length,
              });
              const hiddenCount = canLoadMoreTerms
                ? Math.max(0, taxonomyRow.termCount - sectionTerms.length)
                : 0;
              const inputValue = taxonomyInputByKey[taxonomy] ?? "";
              const listId = `editor-taxonomy-${taxonomy}-suggestions`;
              return (
                <div key={`taxonomy-${taxonomy}`} className="w-full min-w-0 max-w-full space-y-2 overflow-hidden rounded-md border border-stone-200 bg-stone-50 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">
                    {taxonomyRow.label}
                  </div>
                  <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
                    <input
                      list={listId}
                      ref={(node) => {
                        taxonomyInputRefs.current[taxonomy] = node;
                      }}
                      value={inputValue}
                      onChange={(e) => setTaxonomyInputValue(taxonomy, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addOrSelectTaxonomyTerm(taxonomy, readTaxonomyInputValue(taxonomy));
                        }
                      }}
                      placeholder="Type to search or add"
                    className="min-w-0 w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                      disabled={Boolean(pendingTaxonomyWrites[taxonomy])}
                    />
                    <button
                      type="button"
                      className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void addOrSelectTaxonomyTerm(taxonomy, readTaxonomyInputValue(taxonomy))}
                      disabled={Boolean(pendingTaxonomyWrites[taxonomy])}
                    >
                      {pendingTaxonomyWrites[taxonomy] ? "Saving..." : "Select"}
                    </button>
                  </div>
                  <datalist id={listId}>
                    {sectionTerms.map((term) => (
                      <option key={`term-opt-${taxonomy}-${term.id}`} value={term.name} />
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-1">
                    {selectedTermIds.map((id) => {
                      const label = termNameById[id] ?? sectionTerms.find((term) => term.id === id)?.name;
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
                  <div className="flex flex-wrap gap-1">
                    {availableTerms.map((term) => {
                      return (
                        <button
                          key={`term-${taxonomy}-${term.id}`}
                          type="button"
                          onClick={() => toggleTaxonomyTerm(taxonomy, term.id)}
                          className="rounded-full border border-stone-300 bg-white px-2 py-0.5 text-[11px] transition-colors hover:bg-stone-100"
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
                </div>
              );
            })}

            <div className="w-full min-w-0 max-w-full space-y-2 overflow-hidden rounded-md border border-stone-200 bg-stone-50 p-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">Meta Fields</div>
              <div className="grid w-full min-w-0 max-w-full grid-cols-2 gap-1">
                <input
                  list="editor-meta-key-suggestions"
                  value={metaKeyInput}
                  onChange={(e) => setMetaKeyInput(e.target.value)}
                  placeholder="Meta key"
                  className="min-w-0 w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs"
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
                  className="min-w-0 w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                />
              </div>
              <button
                type="button"
                className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100"
                onClick={() => addMetaEntry(metaKeyInput, metaValueInput)}
              >
                Add / Update Meta
              </button>
              <datalist id="editor-meta-key-suggestions">
                {metaKeySuggestions.map((keyName) => (
                  <option key={`meta-opt-${keyName}`} value={keyName} />
                ))}
              </datalist>
              <div className="min-w-0 max-w-full space-y-1">
                {visibleMetaEntries.map((entry) => (
                  <div key={`meta-${entry.key}`} className="w-full min-w-0 max-w-full overflow-hidden rounded border border-stone-200 bg-white px-2 py-1 text-[11px]">
                    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-2">
                      <span className="min-w-0 truncate font-semibold">{entry.key}</span>
                      <input
                        type="text"
                        value={entry.value}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          const nextMetaEntries = updateEditorMetaEntryValue(metaEntriesRef.current, entry.key, nextValue);
                          metaEntriesRef.current = nextMetaEntries;
                          setMetaEntries(nextMetaEntries);
                        }}
                        className="min-w-0 w-full rounded border border-stone-300 bg-white px-2 py-1 text-[11px] text-stone-700"
                      />
                      <button
                        type="button"
                        className="rounded border border-stone-300 px-1.5 py-0.5 text-[10px] hover:bg-stone-100"
                        onClick={() => {
                          const nextMetaEntries = metaEntriesRef.current.filter((item) => item.key !== entry.key);
                          metaEntriesRef.current = nextMetaEntries;
                          setMetaEntries(nextMetaEntries);
                        }}
                      >
                        Remove
                      </button>
                    </div>
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
                      if (!post.siteId) return;
                      openMediaPicker({
                        siteId: post.siteId,
                        title: "Media Library",
                        mode: "pick",
                        allowUpload: canEdit,
                        allowedMimePrefixes: ["image/"],
                        onSelect: (items) => {
                          const next = items[0];
                          const editor = editorRef.current;
                          if (!next?.url || !editor) return;
                          editor
                            .chain()
                            .focus()
                            .setImage({ src: next.url, alt: next.label || "Site media image" })
                            .run();
                          enqueueSave(true);
                          toast.success("Inserted media from library.");
                        },
                      });
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
                    if (!post.siteId) return;
                    openMediaPicker({
                      siteId: post.siteId,
                      title: "Media Library",
                      mode: "pick",
                      allowUpload: canEdit,
                      allowedMimePrefixes: ["image/"],
                      onSelect: (items) => {
                        const next = items[0];
                        if (!next?.url) return;
                        const item = mediaItems.find((entry) => String(entry.id) === next.mediaId);
                        if (item) {
                          setThumbnailFromMediaItem(item);
                          return;
                        }
                        startTransitionThumbnail(async () => {
                          try {
                            const formData = new FormData();
                            formData.append("imageUrl", next.url || "");
                            formData.append("imageFinalName", next.url || "");
                            const response = await onUpdateMetadata(formData, post.id, "image");
                            if ((response as any)?.error) {
                              throw new Error(String((response as any).error));
                            }
                            applyDataUpdate((prev) => ({ ...prev, image: next.url || "" }));
                            toast.success("Thumbnail updated from media manager.");
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Failed to set thumbnail.");
                          }
                        });
                      },
                    });
                  }}
                >
                  Choose from Media Manager
                </button>
              </div>
              </div>
            )}

            <div className="pt-2">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Danger Zone</div>
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2">
                <button
                  type="button"
                  className="w-full rounded-md border border-rose-600 bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canEdit}
                  onClick={() => {
                    setDeleteConfirmation("");
                    setDeleteDialogOpen(true);
                  }}
                >
                  Delete Entry
                </button>
              </div>
            </div>
          </fieldset>
        )}

        {activeSidebarTab?.kind === "plugin" && activeSidebarTab.pluginTab ? (
          <PluginEditorTabPanel
            tab={activeSidebarTab.pluginTab}
            canEdit={canEdit}
            siteId={post.siteId || ""}
            metaEntries={metaEntries}
            mediaItems={mediaItems}
            onMetaEntriesChange={applyMetaEntriesUpdate}
            openMediaPicker={openMediaPicker}
          />
        ) : null}
      </aside>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md border-stone-200 bg-white text-stone-900 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Delete entry</DialogTitle>
            <DialogDescription>
              {deleteConfirmationTarget === "delete"
                ? 'Type "delete" to permanently remove this untitled entry.'
                : `Type "${deleteConfirmationTarget}" to permanently remove this entry.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              type="text"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder={deleteConfirmationTarget}
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            />
            <p className="text-xs text-stone-500">
              This deletes the post, its taxonomy relationships, and its post meta. This cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              className="rounded-md border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!deleteConfirmationMatches || isPendingDelete}
              className="rounded-md border border-rose-300 bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                startTransitionDelete(async () => {
                  try {
                    const formData = new FormData();
                    formData.append("confirm", deleteConfirmation.trim());
                    const response = await deleteDomainPost(formData, post.id);
                    if ((response as any)?.error) {
                      throw new Error(String((response as any).error));
                    }
                    const siteId = String(params?.id || post.siteId || "").trim();
                    const domainKey = String(params?.domainKey || "").trim();
                    setDeleteDialogOpen(false);
                    router.refresh();
                    if (siteId && domainKey) {
                      router.push(`/app/site/${siteId}/domain/${domainKey}`);
                    }
                    toast.success("Entry deleted.");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to delete entry.");
                  }
                });
              }}
            >
              {isPendingDelete ? "Deleting..." : "Delete Entry"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mediaPickerElement}
    </div>
  );
}
