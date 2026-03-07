import { getSession } from "@/lib/auth";
import { getPluginById, getPluginConfig, savePluginConfig } from "@/lib/plugin-runtime";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { sendCommunication } from "@/lib/communications";
import MigrationKitConsole from "@/components/migration-kit-console";
import CollectionOrderManager from "@/components/plugins/collection-order-manager";
import CollectionSetInlineEditor from "@/components/plugins/collection-set-inline-editor";
import CollectionChildEditModal from "@/components/plugins/collection-child-edit-modal";
import CarouselCtaUrlField from "@/components/plugins/carousel-cta-url-field";
import MediaPickerField from "@/components/media/media-picker-field";
import PluginSettingsInlineForm from "@/components/plugins/plugin-settings-inline-form";
import PluginSiteSelect from "@/components/plugins/plugin-site-select";
import db from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { findSiteDataDomainByKey } from "@/lib/site-data-domain-registry";
import { resolveAccessibleSiteId, resolvePrimarySite } from "@/lib/admin-site-selection";
import {
  createSiteDomainPost,
  deleteSiteDomainPostById,
  getSiteDomainPostById,
  listSiteDomainPostMeta,
  listSiteDomainPostMetaMany,
  listSiteDomainPosts,
  replaceSiteDomainPostMeta,
  upsertSiteDomainPostMeta,
  updateSiteDomainPostById,
} from "@/lib/site-domain-post-store";
import { ensureSiteMediaTable, getSiteMediaTable } from "@/lib/site-media-tables";

type Props = {
  params: Promise<{ pluginId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const LEGACY_IMAGE_URL_PLACEHOLDER = "Add an image URL";

function normalizeManagedImageValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === LEGACY_IMAGE_URL_PLACEHOLDER) return "";
  return text;
}

function humanizeCollectionLabel(value: string) {
  const normalized = String(value || "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!normalized) return "Content";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function toSlug(value: string, fallback: string) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function buildRefreshToken() {
  return Date.now().toString(36);
}

async function listMediaItemsForSite(siteId: string) {
  await ensureSiteMediaTable(siteId);
  const mediaTable = getSiteMediaTable(siteId);
  return db
    .select({ id: mediaTable.id, label: mediaTable.label, url: mediaTable.url })
    .from(mediaTable)
    .orderBy(asc(mediaTable.createdAt));
}

async function findMediaItemForSite(siteId: string, mediaId: string) {
  const normalizedMediaId = Number(mediaId || 0);
  if (!Number.isFinite(normalizedMediaId) || normalizedMediaId <= 0) return null;
  await ensureSiteMediaTable(siteId);
  const mediaTable = getSiteMediaTable(siteId);
  const rows = await db
    .select({ id: mediaTable.id, url: mediaTable.url })
    .from(mediaTable)
    .where(eq(mediaTable.id, normalizedMediaId))
    .limit(1);
  return rows[0] || null;
}

async function listCollectionPostsForDomain(siteId: string, domainKey: string) {
  const rows = await listSiteDomainPosts({
    siteId,
    dataDomainKey: domainKey,
    includeInactiveDomains: true,
    includeContent: false,
  });
  return [...rows].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

async function getCollectionMetaValue(siteId: string, domainKey: string, postId: string, key: string) {
  const rows = await listSiteDomainPostMeta({ siteId, dataDomainKey: domainKey, postId });
  return String(rows.find((row) => row.key === key)?.value || "").trim();
}

async function listChildPostIdsByParent(siteId: string, domainKey: string, parentMetaKey: string, parentId: string) {
  const posts = await listCollectionPostsForDomain(siteId, domainKey);
  const postIds = posts.map((post) => post.id);
  if (!postIds.length) return [];
  const rows = await listSiteDomainPostMetaMany({
    siteId,
    dataDomainKey: domainKey,
    postIds,
    keys: [parentMetaKey],
  });
  return rows
    .filter((row) => row.key === parentMetaKey && row.value === parentId)
    .map((row) => row.domainPostId);
}

async function upsertCollectionMeta(siteId: string, domainKey: string, postId: string, key: string, value: string) {
  await upsertSiteDomainPostMeta({
    siteId,
    dataDomainKey: domainKey,
    postId,
    key,
    value,
  });
}

export default async function PluginSetupPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const resolvedSearchParams = (await searchParams) || {};
  const selectedSiteId = String(resolvedSearchParams.siteId || "").trim();
  const pluginId = decodeURIComponent((await params).pluginId);
  const plugin = await getPluginById(pluginId);
  if (!plugin) notFound();
  const pluginData = plugin;
  const tab = String(resolvedSearchParams.tab || (pluginData.contentModel?.kind === "collection" ? "carousels" : "settings"))
    .trim()
    .toLowerCase();
  const config = (await getPluginConfig(pluginData.id)) as Record<string, unknown>;
  const collectionModel = pluginData.contentModel?.kind === "collection" ? pluginData.contentModel : null;

  const accessibleSiteIds = await listSiteIdsForUser(session.user.id);
  const ownedSites = await db.query.sites.findMany({
    where: accessibleSiteIds.length
      ? (sites) => inArray(sites.id, accessibleSiteIds)
      : (sites) => inArray(sites.id, ["__none__"]),
    columns: { id: true, name: true, isPrimary: true, subdomain: true },
    orderBy: (sites, { asc }) => [asc(sites.name), asc(sites.subdomain), asc(sites.id)],
  });
  const mainOwnedSiteId = resolvePrimarySite(ownedSites)?.id || "";
  const normalizedSelectedSiteId = resolveAccessibleSiteId(ownedSites, selectedSiteId);
  const effectiveSiteId = normalizedSelectedSiteId || (ownedSites.length === 1 ? mainOwnedSiteId : "");
  const effectiveSite = ownedSites.find((site) => site.id === effectiveSiteId) || null;
  const migrationRedirectSuffix = normalizedSelectedSiteId ? `&siteId=${encodeURIComponent(normalizedSelectedSiteId)}` : "";

  const isDevTools = pluginData.id === "dev-tools";
  const isMigrationKit = pluginData.id === "export-import";
  const canUseSendMessageTool = await userCan("network.plugins.manage", session.user.id);
  const kernel = await createKernelForRequest(effectiveSiteId || undefined);
  const providers = kernel.getAllPluginCommunicationProviders().map((provider) => ({
    id: `${provider.pluginId}:${provider.id}`,
    label: `${provider.pluginId}:${provider.id}`,
    channels: provider.channels,
  }));
  const migrationResponse = isMigrationKit
      ? await kernel.applyFilters<Response | null>("domain:query", null, {
        name: "export_import.providers",
        params: { siteId: effectiveSiteId || undefined },
      })
    : null;
  const migrationProviderPayload =
    migrationResponse && migrationResponse.ok
      ? ((await migrationResponse.json().catch(() => null)) as {
          providers?: Array<{
            id: string;
            label: string;
            version?: string;
            source?: string;
            enabled?: boolean;
            networkRequired?: boolean;
            capabilities?: { export?: boolean; import?: boolean; inspect?: boolean; apply?: boolean };
          }>;
        } | null)
      : null;
  const migrationProviders = Array.isArray(migrationProviderPayload?.providers)
    ? migrationProviderPayload.providers
    : [];

  if (collectionModel) {
    const model = collectionModel;
    const canManageCollection = effectiveSiteId
      ? await userCan("site.settings.write", session.user.id, { siteId: effectiveSiteId })
      : canUseSendMessageTool;
    if (effectiveSiteId && !canManageCollection) redirect("/app");

    const parentLabel = humanizeCollectionLabel(model.parentTypeKey);
    const childLabel = humanizeCollectionLabel(model.childTypeKey);
    const workflowStates = model.workflowStates?.length
      ? model.workflowStates
      : ["draft", "published", "archived"];

    const [parentDomain, childDomain, mediaItems] = effectiveSiteId
      ? await Promise.all([
          findSiteDataDomainByKey(effectiveSiteId, model.parentTypeKey),
          findSiteDataDomainByKey(effectiveSiteId, model.childTypeKey),
          listMediaItemsForSite(effectiveSiteId),
        ])
      : [null, null, []];

    const setRows = effectiveSiteId && parentDomain
      ? (await listCollectionPostsForDomain(effectiveSiteId, model.parentTypeKey)).map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          slug: row.slug,
          published: row.published,
          createdAt: row.createdAt,
        }))
      : [];

    const setIds = setRows.map((row) => row.id);
    const setMetaRows = setIds.length
      ? await listSiteDomainPostMetaMany({
          siteId: effectiveSiteId,
          dataDomainKey: model.parentTypeKey,
          postIds: setIds,
          keys: [model.parentHandleMetaKey, model.workflowMetaKey],
        })
      : [];

    const setMetaById = new Map<string, Record<string, string>>();
    for (const row of setMetaRows) {
      const bucket = setMetaById.get(row.domainPostId) || {};
      bucket[row.key] = row.value;
      setMetaById.set(row.domainPostId, bucket);
    }

    const collections = setRows.map((row) => {
      const meta = setMetaById.get(row.id) || {};
      const handle = meta[model.parentHandleMetaKey] || row.slug;
      const workflowState =
        meta[model.workflowMetaKey] || (row.published ? "published" : "draft");
      return { ...row, meta, handle, workflowState };
    });

    const selectedSetId =
      String(resolvedSearchParams.set || "").trim() || collections[0]?.id || "";
    const selectedSet = collections.find((entry) => entry.id === selectedSetId) || null;
    const collectionView = String(resolvedSearchParams.view || (selectedSet ? "slides" : "carousels"))
      .trim()
      .toLowerCase() === "slides"
      ? "slides"
      : "carousels";
    const showCreateSet = String(resolvedSearchParams.createSet || "").trim() === "1";
    const showCreateSlide = String(resolvedSearchParams.createSlide || "").trim() === "1";
    const editSetId = String(resolvedSearchParams.editSet || "").trim();
    const deleteSetId = String(resolvedSearchParams.deleteSet || "").trim();
    const editSlideId = String(resolvedSearchParams.editSlide || "").trim();
    const baseParams = new URLSearchParams();
    baseParams.set("tab", "carousels");
    baseParams.set("view", collectionView);
    if (effectiveSiteId) baseParams.set("siteId", effectiveSiteId);
    if (selectedSetId) baseParams.set("set", selectedSetId);

    function buildCollectionHref(
      updates: Record<string, string | undefined>,
      options: { preserveView?: boolean } = {},
    ) {
      const params = new URLSearchParams(baseParams);
      if (!options.preserveView) {
        params.set("view", updates.view ?? collectionView);
      }
      for (const [key, value] of Object.entries(updates)) {
        if (key === "view" && options.preserveView) continue;
        if (value === undefined || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      return `/app/plugins/${pluginData.id}?${params.toString()}`;
    }

    const slideRows = effectiveSiteId && childDomain
      ? (await listCollectionPostsForDomain(effectiveSiteId, model.childTypeKey)).map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          image: row.image,
          published: row.published,
          createdAt: row.createdAt,
        }))
      : [];

    const slideIds = slideRows.map((row) => row.id);
    const slideMetaKeys = [
      model.childParentMetaKey,
      model.workflowMetaKey,
      model.orderMetaKey,
      ...(model.childParentKeyMetaKey ? [model.childParentKeyMetaKey] : []),
      ...(model.mediaMetaKey ? [model.mediaMetaKey] : []),
      ...(model.ctaTextMetaKey ? [model.ctaTextMetaKey] : []),
      ...(model.ctaUrlMetaKey ? [model.ctaUrlMetaKey] : []),
    ];
    const slideMetaRows = slideIds.length
      ? await listSiteDomainPostMetaMany({
          siteId: effectiveSiteId,
          dataDomainKey: model.childTypeKey,
          postIds: slideIds,
          keys: slideMetaKeys,
        })
      : [];

    const slideMetaById = new Map<string, Record<string, string>>();
    for (const row of slideMetaRows) {
      const bucket = slideMetaById.get(row.domainPostId) || {};
      bucket[row.key] = row.value;
      slideMetaById.set(row.domainPostId, bucket);
    }

    const slideCountBySet = new Map<string, number>();
    for (const row of slideRows) {
      const parentId = String(slideMetaById.get(row.id)?.[model.childParentMetaKey] || "").trim();
      if (!parentId) continue;
      slideCountBySet.set(parentId, (slideCountBySet.get(parentId) || 0) + 1);
    }

    const slides = slideRows
      .map((row) => {
        const meta = slideMetaById.get(row.id) || {};
        const sortOrder = Number(meta[model.orderMetaKey] || "");
        const workflowState =
          meta[model.workflowMetaKey] || (row.published ? "published" : "draft");
        return {
          ...row,
          meta,
          workflowState,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 999,
        };
      })
      .filter((row) => {
        if (!selectedSetId) return false;
        return row.meta[model.childParentMetaKey] === selectedSetId;
      })
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    async function saveCollectionSet(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      if (!siteId) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await createKernelForRequest(siteId);
      const domain = await findSiteDataDomainByKey(siteId, model.parentTypeKey);
      if (!domain) return;

      const setId = String(formData.get("setId") || "").trim();
      const title = String(formData.get("title") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const requestedHandle = String(formData.get("embed_key") || "").trim();
      const workflowState = workflowStates.includes(String(formData.get("workflow_state") || "draft"))
        ? String(formData.get("workflow_state") || "draft")
        : "draft";
      if (!title) return;

      const handle = toSlug(requestedHandle || title, "collection");
      const targetId = setId || createId();
      const published = workflowState === "published";

      let previousHandle = "";
      if (setId) {
        previousHandle = await getCollectionMetaValue(siteId, model.parentTypeKey, setId, model.parentHandleMetaKey);
        await updateSiteDomainPostById({
          siteId,
          postId: setId,
          dataDomainKey: model.parentTypeKey,
          patch: {
            title,
            description,
            slug: handle,
            published,
          },
        });
      } else {
        await createSiteDomainPost({
          siteId,
          id: targetId,
          dataDomainKey: model.parentTypeKey,
          title,
          description,
          content: "",
          slug: handle,
          published,
          userId: current.user.id,
        });
      }

      for (const entry of [
        { key: model.parentHandleMetaKey, value: handle },
        { key: model.workflowMetaKey, value: workflowState },
      ]) {
        await upsertCollectionMeta(siteId, model.parentTypeKey, targetId, entry.key, entry.value);
      }

      if (
        setId &&
        model.childParentKeyMetaKey &&
        handle &&
        previousHandle &&
        handle !== previousHandle
      ) {
        const childIds = await listChildPostIdsByParent(siteId, model.childTypeKey, model.childParentMetaKey, setId);
        for (const childId of childIds) {
          await upsertCollectionMeta(siteId, model.childTypeKey, childId, model.childParentKeyMetaKey, handle);
        }
      }

      revalidatePath(`/app/plugins/${pluginData.id}?tab=carousels&siteId=${encodeURIComponent(siteId)}`);
      revalidatePath(`/app/site/${siteId}/settings/plugins`);
      redirect(
        `/app/plugins/${pluginData.id}?tab=carousels&view=carousels&siteId=${encodeURIComponent(siteId)}&set=${encodeURIComponent(targetId)}&savedSet=1`,
      );
    }

    async function deleteCollectionSet(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      const confirm = String(formData.get("confirm") || "").trim().toLowerCase();
      if (!siteId || !setId || confirm !== "delete") return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      const childIds = await listChildPostIdsByParent(siteId, model.childTypeKey, model.childParentMetaKey, setId);
      if (childIds.length) {
        for (const childId of childIds) {
          await deleteSiteDomainPostById({ siteId, postId: childId, dataDomainKey: model.childTypeKey });
        }
      }
      await deleteSiteDomainPostById({ siteId, postId: setId, dataDomainKey: model.parentTypeKey });

      revalidatePath(`/app/plugins/${pluginData.id}?tab=carousels&siteId=${encodeURIComponent(siteId)}`);
      revalidatePath(`/app/site/${siteId}/settings/plugins`);
      redirect(`/app/plugins/${pluginData.id}?tab=carousels&view=carousels&siteId=${encodeURIComponent(siteId)}&deletedSet=1`);
    }

    async function autosaveCollectionSet(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      if (!siteId || !setId) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await createKernelForRequest(siteId);
      const domain = await findSiteDataDomainByKey(siteId, model.parentTypeKey);
      if (!domain) return;

      const title = String(formData.get("title") || "").trim() || "Untitled";
      const description = String(formData.get("description") || "").trim();
      const requestedHandle = String(formData.get("embed_key") || "").trim();
      const workflowState = workflowStates.includes(String(formData.get("workflow_state") || "draft"))
        ? String(formData.get("workflow_state") || "draft")
        : "draft";
      const handle = toSlug(requestedHandle || title, "collection");

      const previousHandle = await getCollectionMetaValue(siteId, model.parentTypeKey, setId, model.parentHandleMetaKey);

      await updateSiteDomainPostById({
        siteId,
        postId: setId,
        dataDomainKey: model.parentTypeKey,
        patch: {
          title,
          description,
          slug: handle,
          published: workflowState === "published",
        },
      });

      for (const entry of [
        { key: model.parentHandleMetaKey, value: handle },
        { key: model.workflowMetaKey, value: workflowState },
      ]) {
        await upsertCollectionMeta(siteId, model.parentTypeKey, setId, entry.key, entry.value);
      }

      if (
        model.childParentKeyMetaKey &&
        handle &&
        previousHandle &&
        handle !== previousHandle
      ) {
        const childIds = await listChildPostIdsByParent(siteId, model.childTypeKey, model.childParentMetaKey, setId);
        for (const childId of childIds) {
          await upsertCollectionMeta(siteId, model.childTypeKey, childId, model.childParentKeyMetaKey, handle);
        }
      }

      revalidatePath(`/app/plugins/${pluginData.id}?tab=carousels&view=carousels&siteId=${encodeURIComponent(siteId)}`);
    }

    async function saveCollectionChild(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      if (!siteId || !setId) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await createKernelForRequest(siteId);
      const [parentDomainRow, childDomainRow] = await Promise.all([
        findSiteDataDomainByKey(siteId, model.parentTypeKey),
        findSiteDataDomainByKey(siteId, model.childTypeKey),
      ]);
      if (!parentDomainRow || !childDomainRow) return;

      const setRecord = await getSiteDomainPostById({
        siteId,
        postId: setId,
        dataDomainKey: model.parentTypeKey,
      });
      if (!setRecord) return;
      const setHandle =
        (await getCollectionMetaValue(siteId, model.parentTypeKey, setId, model.parentHandleMetaKey)) ||
        String(setRecord.slug || "").trim();

      const slideId = String(formData.get("slideId") || "").trim();
      const title = String(formData.get("title") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const mediaId = String(formData.get("media_id") || "").trim();
      const mediaRow =
        mediaId && model.mediaMetaKey
          ? await findMediaItemForSite(siteId, mediaId)
          : null;
      const resolvedImage = String(mediaRow?.url || "").trim();
      const ctaText = model.ctaTextMetaKey ? String(formData.get("cta_text") || "").trim() : "";
      const ctaUrl = model.ctaUrlMetaKey ? String(formData.get("cta_url") || "").trim() : "";
      const workflowState = workflowStates.includes(String(formData.get("workflow_state") || "draft"))
        ? String(formData.get("workflow_state") || "draft")
        : "draft";
      const orderRaw = Number(String(formData.get("sort_order") || "").trim() || "0");
      const sortOrder = Number.isFinite(orderRaw) ? Math.max(0, Math.trunc(orderRaw)) : 0;
      if (!title) return;

      const targetId = slideId || createId();
      const published = workflowState === "published";
      const slideSlug = `${toSlug(title, model.childTypeKey)}-${targetId.slice(-8)}`;

      if (slideId) {
        await updateSiteDomainPostById({
          siteId,
          postId: slideId,
          dataDomainKey: model.childTypeKey,
          patch: {
            title,
            description,
            image: resolvedImage,
            published,
          },
        });
      } else {
        await createSiteDomainPost({
          siteId,
          id: targetId,
          dataDomainKey: model.childTypeKey,
          title,
          description,
          content: "",
          slug: slideSlug,
          image: resolvedImage,
          published,
          userId: current.user.id,
        });
      }

      const metaEntries = [
        { key: model.childParentMetaKey, value: setId },
        { key: model.workflowMetaKey, value: workflowState },
        { key: model.orderMetaKey, value: String(sortOrder) },
        ...(model.childParentKeyMetaKey ? [{ key: model.childParentKeyMetaKey, value: setHandle }] : []),
        ...(model.mediaMetaKey ? [{ key: model.mediaMetaKey, value: mediaId }] : []),
        ...(model.ctaTextMetaKey ? [{ key: model.ctaTextMetaKey, value: ctaText }] : []),
        ...(model.ctaUrlMetaKey ? [{ key: model.ctaUrlMetaKey, value: ctaUrl }] : []),
      ];
      for (const entry of metaEntries) {
        await upsertCollectionMeta(siteId, model.childTypeKey, targetId, entry.key, entry.value);
      }

      revalidatePath(`/app/plugins/${pluginData.id}`);
      revalidatePath(`/app/site/${siteId}/settings/plugins`);
      redirect(
        `/app/plugins/${pluginData.id}?tab=carousels&view=slides&siteId=${encodeURIComponent(siteId)}&set=${encodeURIComponent(setId)}&savedSlide=1&refresh=${encodeURIComponent(buildRefreshToken())}`,
      );
    }

    async function deleteCollectionChild(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      const slideId = String(formData.get("slideId") || "").trim();
      const confirm = String(formData.get("confirm") || "").trim().toLowerCase();
      if (!siteId || !slideId || confirm !== "delete") return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await deleteSiteDomainPostById({ siteId, postId: slideId, dataDomainKey: model.childTypeKey });

      revalidatePath(`/app/plugins/${pluginData.id}`);
      revalidatePath(`/app/site/${siteId}/settings/plugins`);
      redirect(
        `/app/plugins/${pluginData.id}?tab=carousels&view=slides&siteId=${encodeURIComponent(siteId)}&set=${encodeURIComponent(setId)}&deletedSlide=1&refresh=${encodeURIComponent(buildRefreshToken())}`,
      );
    }

    async function autosaveCollectionChild(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      const slideId = String(formData.get("slideId") || "").trim();
      if (!siteId || !setId || !slideId) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await createKernelForRequest(siteId);
      const [parentDomainRow, childDomainRow] = await Promise.all([
        findSiteDataDomainByKey(siteId, model.parentTypeKey),
        findSiteDataDomainByKey(siteId, model.childTypeKey),
      ]);
      if (!parentDomainRow || !childDomainRow) return;

      const setRecord = await getSiteDomainPostById({
        siteId,
        postId: setId,
        dataDomainKey: model.parentTypeKey,
      });
      if (!setRecord) return;
      const setHandle =
        (await getCollectionMetaValue(siteId, model.parentTypeKey, setId, model.parentHandleMetaKey)) ||
        String(setRecord.slug || "").trim();

      const title = String(formData.get("title") || "").trim() || "Untitled";
      const description = String(formData.get("description") || "").trim();
      const mediaId = String(formData.get("media_id") || "").trim();
      const mediaRow =
        mediaId && model.mediaMetaKey
          ? await findMediaItemForSite(siteId, mediaId)
          : null;
      const resolvedImage = String(mediaRow?.url || "").trim();
      const ctaText = model.ctaTextMetaKey ? String(formData.get("cta_text") || "").trim() : "";
      const ctaUrl = model.ctaUrlMetaKey ? String(formData.get("cta_url") || "").trim() : "";
      const workflowState = workflowStates.includes(String(formData.get("workflow_state") || "draft"))
        ? String(formData.get("workflow_state") || "draft")
        : "draft";
      const orderRaw = Number(String(formData.get("sort_order") || "").trim() || "0");
      const sortOrder = Number.isFinite(orderRaw) ? Math.max(0, Math.trunc(orderRaw)) : 0;

      await updateSiteDomainPostById({
        siteId,
        postId: slideId,
        dataDomainKey: model.childTypeKey,
        patch: {
          title,
          description,
          image: resolvedImage,
          published: workflowState === "published",
        },
      });

      const metaEntries = [
        { key: model.childParentMetaKey, value: setId },
        { key: model.workflowMetaKey, value: workflowState },
        { key: model.orderMetaKey, value: String(sortOrder) },
        ...(model.childParentKeyMetaKey ? [{ key: model.childParentKeyMetaKey, value: setHandle }] : []),
        ...(model.mediaMetaKey ? [{ key: model.mediaMetaKey, value: mediaId }] : []),
        ...(model.ctaTextMetaKey ? [{ key: model.ctaTextMetaKey, value: ctaText }] : []),
        ...(model.ctaUrlMetaKey ? [{ key: model.ctaUrlMetaKey, value: ctaUrl }] : []),
      ];
      for (const entry of metaEntries) {
        await upsertCollectionMeta(siteId, model.childTypeKey, slideId, entry.key, entry.value);
      }

      revalidatePath(`/app/plugins/${pluginData.id}`);
    }

    async function reorderCollectionChildren(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      const rawOrder = String(formData.get("order") || "").trim();
      if (!siteId || !rawOrder) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      let parsed: Array<{ id: string; sortOrder: number }> = [];
      try {
        const candidate = JSON.parse(rawOrder);
        if (Array.isArray(candidate)) {
          parsed = candidate
            .map((entry) => ({
              id: String((entry as any)?.id || "").trim(),
              sortOrder: Number((entry as any)?.sortOrder),
            }))
            .filter((entry) => entry.id && Number.isFinite(entry.sortOrder));
        }
      } catch {
        parsed = [];
      }
      if (!parsed.length) return;

      for (const entry of parsed) {
        await upsertCollectionMeta(
          siteId,
          model.childTypeKey,
          entry.id,
          model.orderMetaKey,
          String(Math.max(0, Math.trunc(entry.sortOrder))),
        );
      }

      revalidatePath(`/app/plugins/${pluginData.id}`);
      revalidatePath(`/`);
      revalidatePath("/[domain]", "layout");
      revalidatePath("/[domain]", "page");
    }

    async function toggleCollectionSetEnabled(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const setId = String(formData.get("setId") || "").trim();
      const nextEnabled = String(formData.get("enabled") || "").trim() === "on";
      if (!siteId || !setId) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await updateSiteDomainPostById({
        siteId,
        postId: setId,
        dataDomainKey: model.parentTypeKey,
        patch: {
          published: nextEnabled,
        },
      });
      await upsertCollectionMeta(
        siteId,
        model.parentTypeKey,
        setId,
        model.workflowMetaKey,
        nextEnabled ? "published" : "draft",
      );

      revalidatePath(`/app/plugins/${pluginData.id}?tab=carousels&siteId=${encodeURIComponent(siteId)}`);
    }

    async function saveInlineSettings(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");
      const nextConfig: Record<string, unknown> = {};
      for (const field of pluginData.settingsFields || []) {
        if (field.type === "checkbox") {
          nextConfig[field.key] = formData.get(field.key) === "on";
        } else {
          nextConfig[field.key] = String(formData.get(field.key) || "");
        }
      }
      await savePluginConfig(pluginData.id, nextConfig);
      revalidatePath(`/app/plugins/${pluginData.id}`);
    }

    return (
      <div className="flex max-w-6xl flex-col gap-6 p-8">
        <div>
          <h1 className="font-cal text-3xl font-bold">{pluginData.name}</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
            Manage reusable {parentLabel.toLowerCase()} sets and inline {childLabel.toLowerCase()} entries from a single workspace.
          </p>
        </div>

        <PluginSiteSelect
          currentValue={effectiveSiteId}
          actionPath={`/app/plugins/${pluginData.id}`}
          hiddenParams={{
            tab: tab === "settings" ? "settings" : "carousels",
            ...(tab === "carousels" ? { view: collectionView } : {}),
            ...(tab === "carousels" && selectedSetId ? { set: selectedSetId } : {}),
          }}
          options={ownedSites.map((site) => ({
            id: site.id,
            label: site.name || site.subdomain || site.id,
          }))}
        />

        {!effectiveSiteId ? (
          <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            Select a site to manage {parentLabel.toLowerCase()}s.
          </div>
        ) : !parentDomain || !childDomain ? (
          <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            This plugin&apos;s content types are not available yet. Refresh after plugin registration completes.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={buildCollectionHref({ view: "carousels", createSet: undefined, editSet: undefined, createSlide: undefined, editSlide: undefined })}
                className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                  tab === "carousels"
                    ? "border-black bg-black text-white"
                    : "border-stone-300 bg-white text-black dark:border-stone-700 dark:bg-white dark:text-black"
                }`}
              >
                {parentLabel}s
              </Link>
              <Link
                href={`/app/plugins/${pluginData.id}?tab=settings${effectiveSiteId ? `&siteId=${encodeURIComponent(effectiveSiteId)}` : ""}`}
                className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                  tab === "settings"
                    ? "border-black bg-black text-white"
                    : "border-stone-300 bg-white text-black dark:border-stone-700 dark:bg-white dark:text-black"
                }`}
              >
                Settings
              </Link>
            </div>

            {tab === "settings" ? (
              pluginData.settingsFields?.length ? (
                <PluginSettingsInlineForm
                  pluginId={pluginData.id}
                  siteId={effectiveSiteId || undefined}
                  fields={pluginData.settingsFields.map((field) => ({
                    key: field.key,
                    label: field.label,
                    type: field.type,
                    options: field.options,
                    helpText: field.helpText,
                    placeholder: field.placeholder,
                  }))}
                  values={config}
                  saveAction={saveInlineSettings}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                  This plugin does not expose additional settings yet.
                </div>
              )
            ) : collectionView === "carousels" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-stone-600 dark:text-stone-300">
                    Manage reusable {parentLabel.toLowerCase()} sets. Choose one to edit its {childLabel.toLowerCase()}s.
                  </p>
                  <Link
                    href={showCreateSet ? buildCollectionHref({ createSet: undefined }) : buildCollectionHref({ createSet: "1", editSet: undefined })}
                    className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white"
                  >
                    {showCreateSet ? `Hide Add ${parentLabel}` : `Add ${parentLabel}`}
                  </Link>
                </div>

                {showCreateSet ? (
                  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
                    <div className="w-full max-w-3xl rounded-2xl border border-stone-300 bg-white p-6 shadow-2xl">
                      <div className="mb-5 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-cal text-2xl text-black">Add {parentLabel}</h3>
                          <p className="mt-1 text-sm text-stone-600">
                            Create a new reusable carousel set.
                          </p>
                        </div>
                        <Link
                          href={buildCollectionHref({ createSet: undefined })}
                          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                        >
                          Close
                        </Link>
                      </div>
                      <form action={saveCollectionSet} className="grid gap-4 md:grid-cols-2">
                        <input type="hidden" name="siteId" value={effectiveSiteId} />
                        <label className="grid gap-1 text-sm text-black">
                          <span>Title</span>
                          <input name="title" required className="rounded-md border border-stone-300 bg-white px-3 py-2 text-black" />
                        </label>
                        <label className="grid gap-1 text-sm text-black">
                          <span>Placement</span>
                          <input name="embed_key" placeholder="homepage" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-black" />
                        </label>
                        <label className="grid gap-1 text-sm text-black">
                          <span>Status</span>
                          <select name="workflow_state" defaultValue="published" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-black">
                            {workflowStates.map((state) => (
                              <option key={state} value={state}>{humanizeCollectionLabel(state)}</option>
                            ))}
                          </select>
                        </label>
                        <div className="hidden md:block"></div>
                        <label className="grid gap-1 text-sm text-black md:col-span-2">
                          <span>Description</span>
                          <textarea name="description" rows={4} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-black" />
                        </label>
                        <div className="md:col-span-2 flex gap-2">
                          <button type="submit" className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white">
                            Save {parentLabel}
                          </button>
                          <Link
                            href={buildCollectionHref({ createSet: undefined })}
                            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                          >
                            Cancel
                          </Link>
                        </div>
                      </form>
                    </div>
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                      <tr>
                        <th className="px-4 py-3">{parentLabel}</th>
                        <th className="px-4 py-3">Placement</th>
                        <th className="px-4 py-3">Slides</th>
                        <th className="px-4 py-3">Enabled</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collections.map((entry) => {
                        const enabled = entry.workflowState === "published";
                        const isEditing = editSetId === entry.id;
                        const isDeleting = deleteSetId === entry.id;
                        const openHref = buildCollectionHref({ view: "slides", set: entry.id, editSlide: undefined, createSlide: undefined, editSet: undefined, deleteSet: undefined });
                        return (
                            <tr key={entry.id} className="border-t border-stone-200 align-top dark:border-stone-800">
                              <td className="px-4 py-3">
                                <Link
                                  href={openHref}
                                  className="block w-full font-medium text-stone-900 underline-offset-2 hover:underline dark:text-white"
                                >
                                  {entry.title || "Untitled"}
                                  {entry.description ? (
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{entry.description}</div>
                                  ) : null}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
                                <Link href={openHref} className="block w-full hover:underline">
                                  {entry.handle}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
                                <Link href={openHref} className="block w-full hover:underline">
                                  {slideCountBySet.get(entry.id) || 0}
                                </Link>
                              </td>
                              <td className="px-4 py-3">
                                <form action={toggleCollectionSetEnabled}>
                                  <input type="hidden" name="siteId" value={effectiveSiteId} />
                                  <input type="hidden" name="setId" value={entry.id} />
                                  <input type="hidden" name="enabled" value={enabled ? "" : "on"} />
                                  <button type="submit" className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${enabled ? "border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-700 dark:bg-lime-950/30 dark:text-lime-200" : "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"}`}>
                                    Enabled
                                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${enabled ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70 dark:bg-stone-600"}`}></span>
                                  </button>
                                </form>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <Link
                                    href={isEditing ? buildCollectionHref({ editSet: undefined }) : buildCollectionHref({ editSet: entry.id, createSet: undefined, deleteSet: undefined })}
                                    className="rounded-md border border-stone-300 px-2 py-1 text-stone-700 dark:border-stone-700 dark:text-stone-200"
                                    aria-label={`Edit ${entry.title || parentLabel}`}
                                    title="Edit"
                                  >
                                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
                                      <path d="M11.9 1.7a1.5 1.5 0 0 1 2.1 2.1l-7.7 7.7-3.2.8.8-3.2 8-7.4Zm.7.7-.5-.5-7.3 6.8-.4 1.5 1.5-.4 6.7-7.4Z" />
                                    </svg>
                                  </Link>
                                  <Link
                                    href={isDeleting ? buildCollectionHref({ deleteSet: undefined }) : buildCollectionHref({ deleteSet: entry.id, editSet: undefined, createSet: undefined })}
                                    className="rounded-md border border-rose-200 px-2 py-1 text-rose-700 dark:border-rose-800"
                                    aria-label={`Delete ${entry.title || parentLabel}`}
                                    title="Delete"
                                  >
                                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
                                      <path d="M6 1h4l.7 1H14v1H2V2h3.3L6 1Zm-1 4h1v7H5V5Zm3 0h1v7H8V5Zm3 0h1v7h-1V5ZM4 4h8l-.5 10.2A1 1 0 0 1 10.5 15h-5a1 1 0 0 1-1-.8L4 4Z" />
                                    </svg>
                                  </Link>
                                </div>
                              </td>
                            </tr>
                        );
                      })}
                      {collections.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-stone-500 dark:text-stone-400">
                            No {parentLabel.toLowerCase()}s yet for this site.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {editSetId
                  ? (() => {
                      const record = collections.find((entry) => entry.id === editSetId);
                      if (!record) return null;
                      return (
                        <CollectionSetInlineEditor
                          siteId={effectiveSiteId}
                          parentLabel={parentLabel}
                          closeHref={buildCollectionHref({ editSet: undefined })}
                          workflowStates={workflowStates}
                          record={{
                            id: record.id,
                            title: record.title || "",
                            description: record.description || "",
                            embedKey: record.handle,
                            workflowState: record.workflowState,
                          }}
                          saveAction={autosaveCollectionSet}
                          deleteAction={deleteCollectionSet}
                        />
                      );
                    })()
                  : null}

                {deleteSetId
                  ? (() => {
                      const record = collections.find((entry) => entry.id === deleteSetId);
                      if (!record) return null;
                      return (
                        <div className="rounded-lg border border-rose-200 bg-white p-5 dark:border-rose-800 dark:bg-black">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="font-cal text-xl text-stone-900 dark:text-white">Delete {parentLabel}</h3>
                              <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                                {record.title || "Untitled"} and all of its {childLabel.toLowerCase()}s will be removed.
                              </p>
                            </div>
                            <Link
                              href={buildCollectionHref({ deleteSet: undefined })}
                              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-stone-50 dark:border-stone-700 dark:bg-white dark:text-black"
                            >
                              Cancel
                            </Link>
                          </div>
                          <form action={deleteCollectionSet} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="siteId" value={effectiveSiteId} />
                            <input type="hidden" name="setId" value={record.id} />
                            <label className="grid gap-1 text-xs">
                              <span>Type delete to remove</span>
                              <input name="confirm" className="rounded-md border border-rose-200 px-2 py-1 dark:border-rose-800 dark:bg-black" />
                            </label>
                            <button type="submit" className="rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:hover:bg-rose-950/30">
                              Delete {parentLabel}
                            </button>
                          </form>
                        </div>
                      );
                    })()
                  : null}
              </div>
            ) : selectedSet ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                      <Link href={buildCollectionHref({ view: "carousels", set: selectedSet.id, editSet: undefined, createSet: undefined, createSlide: undefined, editSlide: undefined })} className="hover:underline">
                        {parentLabel}s
                      </Link>
                      <span className="mx-2">/</span>
                      <span>{selectedSet.title || selectedSet.handle}</span>
                    </div>
                    <h2 className="font-cal text-2xl text-stone-900 dark:text-white">{selectedSet.title || selectedSet.handle}</h2>
                    <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">Editing {childLabel.toLowerCase()}s for placement: {selectedSet.handle}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={buildCollectionHref({ view: "carousels", createSlide: undefined, editSlide: undefined })}
                      className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-stone-50 dark:border-stone-700 dark:bg-white dark:text-black"
                    >
                      Back to {parentLabel}s
                    </Link>
                    <Link
                      href={showCreateSlide ? buildCollectionHref({ createSlide: undefined }) : buildCollectionHref({ createSlide: "1", editSlide: undefined })}
                      className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white"
                    >
                      {showCreateSlide ? `Hide Add ${childLabel}` : `Add ${childLabel}`}
                    </Link>
                  </div>
                </div>

                <CollectionOrderManager
                  siteId={effectiveSiteId}
                  items={slides.map((slide) => ({
                    id: slide.id,
                    title: slide.title || "Untitled",
                    sortOrder: slide.sortOrder,
                    status: humanizeCollectionLabel(slide.workflowState),
                    editHref: buildCollectionHref({ editSlide: slide.id, createSlide: undefined }),
                  }))}
                  saveOrderAction={reorderCollectionChildren}
                  extraFormData={{ setId: selectedSet.id }}
                  title="Slide Order"
                />

                {showCreateSlide ? (
                  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
                    <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-stone-300 bg-white p-6 shadow-2xl">
                      <form id="create-carousel-slide" action={saveCollectionChild}>
                        <input type="hidden" name="siteId" value={effectiveSiteId} />
                        <input type="hidden" name="setId" value={selectedSet.id} />

                      <div className="mb-5 flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <label className="block px-2">
                            <span className="sr-only">Title</span>
                            <input
                              name="title"
                              required
                              placeholder={`New ${childLabel}`}
                              className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1 font-cal text-3xl text-black outline-none focus:border-stone-300 focus:bg-stone-50"
                            />
                          </label>
                          <p className="mt-2 px-2 text-sm text-stone-600">
                            Create a new slide for the {selectedSet.title || selectedSet.handle} carousel.
                          </p>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Status</div>
                            <select
                              name="workflow_state"
                              form="create-carousel-slide"
                              defaultValue="published"
                              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black"
                            >
                              {workflowStates.map((state) => (
                                <option key={state} value={state}>
                                  {humanizeCollectionLabel(state)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Sort Order</div>
                            <input
                              name="sort_order"
                              form="create-carousel-slide"
                              type="number"
                              defaultValue="0"
                              className="w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-black"
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Link
                              href={buildCollectionHref({ createSlide: undefined })}
                              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black"
                            >
                              Close
                            </Link>
                            <button type="submit" className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white">
                              Save {childLabel}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
                          <MediaPickerField
                            siteId={effectiveSiteId}
                            name="media_id"
                            label="Media Manager"
                            allowUpload
                            allowedMimePrefixes={["image/"]}
                          />
                        </div>

                        <div className="space-y-4">
                          <label className="grid gap-2 text-sm text-black">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">Description</span>
                            <textarea name="description" rows={10} className="rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm text-black" />
                          </label>

                          <label className="grid gap-2 text-sm text-black">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">CTA Text</span>
                            <textarea name="cta_text" rows={3} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black" />
                          </label>

                          <label className="grid gap-2 text-sm text-black">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">CTA URL</span>
                            <CarouselCtaUrlField
                              name="cta_url"
                              siteSubdomain={effectiveSite?.subdomain || ""}
                              rows={3}
                              className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-black"
                            />
                          </label>
                        </div>
                      </div>
                      </form>
                    </div>
                  </div>
                ) : null}

                {editSlideId
                  ? (() => {
                      const slide = slides.find((entry) => entry.id === editSlideId);
                      if (!slide) return null;
                      return (
                        <CollectionChildEditModal
                          siteId={effectiveSiteId}
                          siteSubdomain={effectiveSite?.subdomain || ""}
                          setId={selectedSet.id}
                          childLabel={childLabel}
                          closeHref={buildCollectionHref({ editSlide: undefined })}
                          workflowStates={workflowStates}
                          mediaItems={mediaItems.map((item) => ({
                            id: item.id,
                            label: item.label || item.url,
                            url: item.url,
                          }))}
                          slide={{
                            id: slide.id,
                            title: slide.title || "",
                            description: slide.description || "",
                            image: normalizeManagedImageValue(slide.image),
                            workflowState: slide.workflowState,
                            mediaId: model.mediaMetaKey ? slide.meta[model.mediaMetaKey] || "" : "",
                            ctaText: model.ctaTextMetaKey ? slide.meta[model.ctaTextMetaKey] || "" : "",
                            ctaUrl: model.ctaUrlMetaKey ? slide.meta[model.ctaUrlMetaKey] || "" : "",
                            sortOrder: String(slide.meta[model.orderMetaKey] || slide.sortOrder || 0),
                          }}
                          saveAction={autosaveCollectionChild}
                          deleteAction={deleteCollectionChild}
                        />
                      );
                    })()
                  : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                Create a {parentLabel.toLowerCase()} first to start adding {childLabel.toLowerCase()}s.
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  async function sendMessage(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) throw new Error("Not authenticated.");
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) throw new Error("Network admin required.");

    const providerId = String(formData.get("providerId") || "").trim();
    const from = String(formData.get("from") || "").trim();
    const to = String(formData.get("to") || "").trim();
    const cc = String(formData.get("cc") || "").trim();
    const bcc = String(formData.get("bcc") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();
    const subject = String(formData.get("subject") || "").trim();
    const body = String(formData.get("body") || "").trim();
    if (!to) throw new Error("To is required.");
    if (!body) throw new Error("Body is required.");

    await sendCommunication(
      {
        channel: "email",
        to,
        subject,
        body,
        category: "transactional",
        metadata: {
          from,
          cc,
          bcc,
          replyTo,
          preferredProvider: providerId,
          sentFrom: "dev-tools:send-message",
        },
      },
      { createdByUserId: current.user.id },
    );
  }

  async function save(formData: FormData) {
    "use server";
    const nextConfig: Record<string, unknown> = {};
    for (const field of pluginData.settingsFields || []) {
      if (field.type === "checkbox") {
        nextConfig[field.key] = formData.get(field.key) === "on";
      } else {
        nextConfig[field.key] = String(formData.get(field.key) || "");
      }
    }
    await savePluginConfig(pluginData.id, nextConfig);
    revalidatePath(`/plugins/${pluginData.id}`);
    revalidatePath(`/app/plugins/${pluginData.id}`);
    redirect(`/app/plugins/${pluginData.id}?tab=settings&saved=1`);
  }

  async function toggleMigrationProvider(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;

    const providerId = String(formData.get("providerId") || "").trim().toLowerCase();
    const nextEnabled = String(formData.get("enabled") || "") === "on";
    if (!providerId) return;

    const currentConfig = (await getPluginConfig("export-import")) as Record<string, unknown>;
    const rawDisabled = currentConfig.disabledProviders;
    const rawRequired = currentConfig.networkRequiredProviders;
    const disabled = new Set(
      Array.isArray(rawDisabled)
        ? rawDisabled.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawDisabled || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawDisabled || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );
    const requiredSet = new Set(
      Array.isArray(rawRequired)
        ? rawRequired.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawRequired || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawRequired || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );

    if (nextEnabled) disabled.delete(providerId);
    else {
      disabled.add(providerId);
      // Mirror plugin network behavior: disabled providers cannot remain network-required.
      requiredSet.delete(providerId);
    }

    await savePluginConfig("export-import", {
      ...currentConfig,
      disabledProviders: Array.from(disabled.values()),
      networkRequiredProviders: Array.from(requiredSet.values()),
    });
    revalidatePath("/plugins/export-import");
    revalidatePath("/app/plugins/export-import");
    redirect(`/app/plugins/export-import?tab=providers&saved=1${migrationRedirectSuffix}`);
  }

  async function toggleMigrationProviderNetworkRequired(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;

    const providerId = String(formData.get("providerId") || "").trim().toLowerCase();
    const nextRequired = String(formData.get("required") || "") === "on";
    if (!providerId) return;

    const currentConfig = (await getPluginConfig("export-import")) as Record<string, unknown>;
    const rawRequired = currentConfig.networkRequiredProviders;
    const rawDisabled = currentConfig.disabledProviders;
    const requiredSet = new Set(
      Array.isArray(rawRequired)
        ? rawRequired.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawRequired || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawRequired || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );
    const disabled = new Set(
      Array.isArray(rawDisabled)
        ? rawDisabled.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawDisabled || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawDisabled || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );

    if (nextRequired) {
      requiredSet.add(providerId);
      // Mirror plugin network behavior: network-required implies enabled.
      disabled.delete(providerId);
    }
    else requiredSet.delete(providerId);

    await savePluginConfig("export-import", {
      ...currentConfig,
      networkRequiredProviders: Array.from(requiredSet.values()),
      disabledProviders: Array.from(disabled.values()),
    });
    revalidatePath("/plugins/export-import");
    revalidatePath("/app/plugins/export-import");
    redirect(`/app/plugins/export-import?tab=providers&saved=1${migrationRedirectSuffix}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="font-cal text-3xl font-bold">{pluginData.name}</h1>
      {pluginData.developer ? (
        <p className="text-xs text-stone-500 italic">
          by{" "}
          {pluginData.website ? (
            <a href={pluginData.website} target="_blank" rel="noreferrer">
              {pluginData.developer}
            </a>
          ) : (
            pluginData.developer
          )}
        </p>
      ) : null}
      <p className="text-sm text-stone-600">{pluginData.description}</p>

      {isMigrationKit ? (
        <>
          <div className="flex gap-2 border-b border-stone-200 pb-2">
            <Link
              href={`/plugins/${pluginData.id}?tab=settings${normalizedSelectedSiteId ? `&siteId=${encodeURIComponent(normalizedSelectedSiteId)}` : ""}`}
              className={`rounded border px-3 py-1 text-sm ${tab === "settings" ? "border-stone-700 bg-stone-700 text-white" : "border-stone-300 bg-white text-black"}`}
            >
              Settings
            </Link>
            <Link
              href={`/plugins/${pluginData.id}?tab=providers${normalizedSelectedSiteId ? `&siteId=${encodeURIComponent(normalizedSelectedSiteId)}` : ""}`}
              className={`rounded border px-3 py-1 text-sm ${tab === "providers" ? "border-stone-700 bg-stone-700 text-white" : "border-stone-300 bg-white text-black"}`}
            >
              Providers
            </Link>
          </div>

          {tab === "providers" ? (
            <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-5 text-black">
              <div>
                <h2 className="font-cal text-xl text-black">Child Providers</h2>
                <p className="text-xs text-black">
                  Child plugins install normally, then appear here for enable/disable control.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-white text-left text-black">
                    <tr>
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Capabilities</th>
                      <th className="px-3 py-2">Enabled</th>
                      <th className="px-3 py-2">Network</th>
                    </tr>
                  </thead>
                  <tbody>
                    {migrationProviders.map((provider) => (
                      <tr key={provider.id} className="border-t border-stone-200">
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-black">{provider.label || provider.id}</p>
                          <p className="text-xs text-black">{provider.id}</p>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-black">
                          {(provider.source || "plugin").toString()}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-black">
                          {[
                            provider.capabilities?.export ? "export" : null,
                            provider.capabilities?.import ? "import" : null,
                            provider.capabilities?.inspect ? "inspect" : null,
                            provider.capabilities?.apply ? "apply" : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "-"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <form action={toggleMigrationProvider}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input type="hidden" name="enabled" value={provider.enabled === false ? "on" : ""} />
                            <button
                              type="submit"
                              title={provider.enabled === false ? "Enable provider" : "Disable provider"}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                                provider.enabled === false
                                  ? "border-stone-500 bg-stone-600"
                                  : "border-emerald-700 bg-emerald-700"
                              }`}
                            >
                              {provider.enabled === false ? "Disabled" : "Enabled"}
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    provider.enabled === false
                                      ? "bg-stone-300/70"
                                      : "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <form action={toggleMigrationProviderNetworkRequired}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input type="hidden" name="required" value={provider.networkRequired === true ? "" : "on"} />
                            <button
                              type="submit"
                              title={provider.networkRequired === true ? "Set provider as optional" : "Set provider as network required"}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                                provider.networkRequired === true
                                  ? "border-emerald-700 bg-emerald-700"
                                  : "border-stone-500 bg-stone-600"
                              }`}
                            >
                              Network
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    provider.networkRequired === true
                                      ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                                      : "bg-stone-300/70"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {migrationProviders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-sm text-black">
                          No providers registered yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <MigrationKitConsole siteId={normalizedSelectedSiteId || null} providers={migrationProviders} />
          )}
        </>
      ) : isDevTools ? (
        <>
          <div className="flex gap-2 border-b border-stone-200 pb-2 dark:border-stone-700">
            <Link
              href={`/plugins/${pluginData.id}?tab=settings`}
              className={`rounded border px-3 py-1 text-sm ${tab === "settings" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black dark:border-stone-700 dark:bg-white dark:text-black"}`}
            >
              Settings
            </Link>
            <Link
              href={`/plugins/${pluginData.id}?tab=send-message`}
              className={`rounded border px-3 py-1 text-sm ${tab === "send-message" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black dark:border-stone-700 dark:bg-white dark:text-black"}`}
            >
              Send Message
            </Link>
          </div>

          {tab === "send-message" ? (
            canUseSendMessageTool ? (
              <form action={sendMessage} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
                <h2 className="font-cal text-xl dark:text-white">Send Message</h2>
                <p className="text-xs text-stone-500">Network-admin test compose tool for communication providers.</p>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Provider</span>
                  <select name="providerId" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white">
                    <option value="">Auto select (by channel)</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label} [{provider.channels.join(", ")}]
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">From</span>
                  <input name="from" placeholder="noreply@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">To</span>
                  <input name="to" required placeholder="recipient@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">CC</span>
                  <input name="cc" placeholder="cc@example.com, cc2@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">BCC</span>
                  <input name="bcc" placeholder="bcc@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Reply-To</span>
                  <input name="replyTo" placeholder="reply@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Subject</span>
                  <input name="subject" placeholder="Message subject" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Body</span>
                  <textarea name="body" required rows={8} placeholder="Compose message..." className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <button type="submit" className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Send Message</button>
              </form>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Network admin permission is required to use Send Message.
              </div>
            )
          ) : (pluginData.settingsFields || []).length > 0 ? (
            <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
              {(pluginData.settingsFields || []).map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800">{field.label}</span>
                  {field.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      name={field.key}
                      defaultChecked={
                        config[field.key] === undefined || config[field.key] === null
                          ? ["true", "1", "yes", "on"].includes(String(field.defaultValue ?? "").trim().toLowerCase())
                          : Boolean(config[field.key])
                      }
                      className="h-4 w-4"
                    />
                  ) : field.type === "select" ? (
                    <select
                      name={field.key}
                      defaultValue={String(config[field.key] || field.defaultValue || "")}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    >
                      {(field.options || []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      name={field.key}
                      defaultValue={String(config[field.key] || "")}
                      placeholder={field.placeholder || ""}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    />
                  ) : (
                    <input
                      type={field.type || "text"}
                      name={field.key}
                      defaultValue={String(config[field.key] || "")}
                      placeholder={field.placeholder || ""}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    />
                  )}
                  {typeof field.helpText === "string" && field.helpText.trim().length > 0 ? (
                    <span className="text-xs text-stone-500">{field.helpText}</span>
                  ) : null}
                </label>
              ))}
              <button type="submit" className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Save</button>
            </form>
          ) : (
            <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
          )}
        </>
      ) : (pluginData.settingsFields || []).length > 0 ? (
        <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
          {(pluginData.settingsFields || []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-800">{field.label}</span>
              {field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  name={field.key}
                  defaultChecked={
                    config[field.key] === undefined || config[field.key] === null
                      ? ["true", "1", "yes", "on"].includes(String(field.defaultValue ?? "").trim().toLowerCase())
                      : Boolean(config[field.key])
                  }
                  className="h-4 w-4"
                />
              ) : field.type === "select" ? (
                <select
                  name={field.key}
                  defaultValue={String(config[field.key] || field.defaultValue || "")}
                  className="rounded-md border border-stone-300 px-2 py-1"
                >
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  name={field.key}
                  defaultValue={String(config[field.key] || "")}
                  placeholder={field.placeholder || ""}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              ) : (
                <input
                  type={field.type || "text"}
                  name={field.key}
                  defaultValue={String(config[field.key] || "")}
                  placeholder={field.placeholder || ""}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              )}
              {typeof field.helpText === "string" && field.helpText.trim().length > 0 ? (
                <span className="text-xs text-stone-500">{field.helpText}</span>
              ) : null}
            </label>
          ))}
          <button type="submit" className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Save</button>
        </form>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
      )}
    </div>
  );
}
