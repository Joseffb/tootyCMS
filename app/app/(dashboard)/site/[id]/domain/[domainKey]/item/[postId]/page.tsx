import {
  PendingAdminItemHydration,
  ReplaceAdminItemUrlInPlace,
} from "@/components/admin/pending-admin-item-hydration";
import Editor from "@/components/editor/editor";
import { getSession } from "@/lib/auth";
import { getSiteDataDomainByKey, updateDomainPost, updateDomainPostMetadata } from "@/lib/actions";
import db from "@/lib/db";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import {
  canUserMutateDomainPost,
  canUserOpenFreshDraftEditorShell,
  userCan,
} from "@/lib/authorization";
import { getSiteWritingSettings } from "@/lib/cms-config";
import { hasEnabledCommentProvider } from "@/lib/comments-spine";
import { getSiteDomainPostById, listSiteDomainPostMeta } from "@/lib/site-domain-post-store";
import { getSiteTaxonomyTables, withSiteTaxonomyTableRecovery } from "@/lib/site-taxonomy-tables";
import { resolveAuthorizedSiteForAnyCapability } from "@/lib/admin-site-selection";
import { getDomainPostAdminItemPath } from "@/lib/domain-post-admin-routes";
import { unstable_noStore as noStore } from "next/cache";
import { defaultEditorContent } from "@/lib/content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
    postId: string;
  }>;
  searchParams?: Promise<{
    pending?: string;
    new?: string;
  }>;
};

function isFreshDraftHydrationCandidate(input: {
  published?: boolean | null;
  title?: string | null;
  description?: string | null;
  content?: string | null;
  updatedAt?: string | Date | null;
}) {
  const normalizedContent = String(input.content || "").trim();
  const hasMeaningfulContent = (() => {
    if (!normalizedContent) return false;
    try {
      const parsed = JSON.parse(normalizedContent);
      return JSON.stringify(parsed) !== JSON.stringify(defaultEditorContent);
    } catch {
      return true;
    }
  })();
  return (
    !input.published &&
    !String(input.title || "").trim() &&
    !String(input.description || "").trim() &&
    !hasMeaningfulContent &&
    (() => {
      if (!input.updatedAt) return true;
      const updatedAt = input.updatedAt instanceof Date ? input.updatedAt : new Date(String(input.updatedAt));
      if (Number.isNaN(updatedAt.getTime())) return true;
      return Date.now() - updatedAt.getTime() < 2 * 60 * 1000;
    })()
  );
}

async function getSiteDomainPostByIdWithRetry(input: {
  siteId: string;
  postId: string;
  dataDomainKey?: string;
}, attempts = 45) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const record = await getSiteDomainPostById(input);
    if (record) return record;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2_000)));
    }
  }
  return null;
}

async function getHydratedPendingDomainPostWithRetry(input: {
  siteId: string;
  postId: string;
  dataDomainKey?: string;
  initialRecord: Awaited<ReturnType<typeof getSiteDomainPostById>>;
}, attempts = 12) {
  let latest = input.initialRecord;
  if (!latest || !isFreshDraftHydrationCandidate(latest)) return latest;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const record = await getSiteDomainPostById({
      siteId: input.siteId,
      postId: input.postId,
      dataDomainKey: input.dataDomainKey,
    });
    if (record) {
      latest = record;
      if (!isFreshDraftHydrationCandidate(record)) {
        return record;
      }
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 500)));
    }
  }
  return latest;
}

async function getDomainPostTaxonomyRowsWithRetry(input: {
  siteId: string;
  postId: string;
}, attempts = 1) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rows = await withSiteTaxonomyTableRecovery(input.siteId, async () => {
      const { termsTable, termTaxonomiesTable, termRelationshipsTable } = getSiteTaxonomyTables(input.siteId);
      return db
        .select({
          id: termTaxonomiesTable.id,
          taxonomy: termTaxonomiesTable.taxonomy,
          name: termsTable.name,
        })
        .from(termRelationshipsTable)
        .innerJoin(termTaxonomiesTable, eq(termRelationshipsTable.termTaxonomyId, termTaxonomiesTable.id))
        .innerJoin(termsTable, eq(termTaxonomiesTable.termId, termsTable.id))
        .where(eq(termRelationshipsTable.objectId, input.postId));
    });
    if (rows.length > 0 || attempt === attempts) return rows;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2_000)));
  }
  return [];
}

async function getDomainPostMetaWithRetry(input: {
  siteId: string;
  dataDomainKey: string;
  postId: string;
}, attempts = 1) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rows = await listSiteDomainPostMeta(input);
    if (rows.length > 0 || attempt === attempts) return rows;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2_000)));
  }
  return [];
}

export default async function DomainPostItemPage({ params, searchParams }: Props) {
  noStore();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id, domainKey, postId } = await params;
  const resolvedSearchParams = (await searchParams) || {};
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);
  const resolvedPostId = decodeURIComponent(postId);
  const canonicalPath = getDomainPostAdminItemPath(siteId, resolvedDomainKey, resolvedPostId);
  const isPendingHydration = String(resolvedSearchParams.pending || "").trim() === "1";
  const isNewDraft = String(resolvedSearchParams.new || "").trim() === "1";
  const pendingPostReadAttempts = isNewDraft ? 1 : isPendingHydration ? 60 : 45;
  const { site } = await resolveAuthorizedSiteForAnyCapability(session.user.id, siteId, [
    "site.content.read",
    "site.content.create",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.publish",
  ]);
  if (!site) {
    notFound();
  }
  const effectiveSiteId = site.id;

  const domainPromise = getSiteDataDomainByKey(effectiveSiteId, resolvedDomainKey);
  const postPromise = getSiteDomainPostByIdWithRetry(
    {
      siteId: effectiveSiteId,
      postId: resolvedPostId,
      dataDomainKey: resolvedDomainKey,
    },
    pendingPostReadAttempts,
  );
  const [domain, pendingData] = await Promise.all([domainPromise, postPromise]);
  const shouldHydrateFreshDraft =
    pendingData != null &&
    (isPendingHydration || isFreshDraftHydrationCandidate(pendingData));
  const data = shouldHydrateFreshDraft
    ? await getHydratedPendingDomainPostWithRetry({
        siteId: effectiveSiteId,
        postId: resolvedPostId,
        dataDomainKey: resolvedDomainKey,
        initialRecord: pendingData,
      })
    : pendingData;
  if (!domain) {
    notFound();
  }

  if (!data && isNewDraft) {
    const [canCreate, canPublish, writingSettings, commentsPluginEnabled] = await Promise.all([
      userCan("site.content.create", session.user.id, { siteId: effectiveSiteId }),
      userCan("site.content.publish", session.user.id, { siteId: effectiveSiteId }),
      getSiteWritingSettings(effectiveSiteId),
      hasEnabledCommentProvider(effectiveSiteId),
    ]);
    if (!canCreate) {
      notFound();
    }
    const commentsGateEnabled = commentsPluginEnabled && writingSettings.enableComments;
    return (
      <Editor
        post={{
          id: resolvedPostId,
          siteId: effectiveSiteId,
          dataDomainId: domain.id,
          dataDomainKey: domain.key,
          dataDomainLabel: domain.label,
          title: "",
          description: "",
          content: "",
          password: "",
          usePassword: false,
          layout: null,
          slug: "",
          image: "",
          imageBlurhash: "",
          published: false,
          userId: session.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          categories: [],
          tags: [],
          meta: [],
          taxonomyAssignments: [],
          site: {
            subdomain: site.subdomain ?? null,
          },
        }}
        defaultEditorMode="rich-text"
        defaultEnableComments={commentsGateEnabled}
        commentsPluginEnabled={commentsGateEnabled}
        onSave={updateDomainPost}
        onUpdateMetadata={updateDomainPostMetadata}
        canEdit
        canPublish={canPublish}
        materializeDraftOnFirstSave
      />
    );
  }

  if (!data && isPendingHydration) {
    return <PendingAdminItemHydration canonicalPath={canonicalPath} />;
  }

  if (!data) {
    notFound();
  }

  const isFreshDraft = isFreshDraftHydrationCandidate(data);
  const shouldFastPathHydration = isFreshDraft;
  const pendingReadRetryAttempts = isPendingHydration && !isFreshDraft ? 36 : 1;
  const canEditPromise = canUserMutateDomainPost(session.user.id, resolvedPostId, "edit", effectiveSiteId);
  const [canRead, canPublish, taxonomyRows, metaRows, writingSettings, commentsPluginEnabled, canEdit] = await Promise.all([
    data.siteId ? userCan("site.content.read", session.user.id, { siteId: data.siteId }) : Promise.resolve(false),
    data.siteId ? userCan("site.content.publish", session.user.id, { siteId: data.siteId }) : Promise.resolve(false),
    shouldFastPathHydration
      ? Promise.resolve([])
      : getDomainPostTaxonomyRowsWithRetry(
          {
            siteId: effectiveSiteId,
            postId: data.id,
          },
          pendingReadRetryAttempts,
        ),
    shouldFastPathHydration
      ? Promise.resolve([])
      : getDomainPostMetaWithRetry(
          {
            siteId: effectiveSiteId,
            dataDomainKey: resolvedDomainKey,
            postId: data.id,
          },
          pendingReadRetryAttempts,
        ),
    getSiteWritingSettings(effectiveSiteId),
    hasEnabledCommentProvider(effectiveSiteId),
    canEditPromise,
  ]);

  const allowOwnerFreshDraftEdit = canUserOpenFreshDraftEditorShell({
    userId: session.user.id,
    canRead,
    canEdit: canEdit.allowed,
    post: data,
  });

  if (!canEdit.allowed && !allowOwnerFreshDraftEdit && !canRead) {
    notFound();
  }

  const categoryRows = taxonomyRows
    .filter((row) => row.taxonomy === "category")
    .map((row) => ({ categoryId: row.id }));
  const tagRows = taxonomyRows.filter((row) => row.taxonomy === "tag").map((row) => ({ tagId: row.id }));

  const hydratedPost = {
    ...data,
    categories: categoryRows,
    tags: tagRows,
    meta: metaRows,
    taxonomyAssignments: taxonomyRows.map((row) => ({
      taxonomy: row.taxonomy,
      termTaxonomyId: row.id,
      name: row.name,
    })),
  };
  const commentsGateEnabled = commentsPluginEnabled && writingSettings.enableComments;

  return (
    <>
      {isPendingHydration ? <ReplaceAdminItemUrlInPlace canonicalPath={canonicalPath} waitForEditorReady /> : null}
      <Editor
        post={hydratedPost}
        defaultEditorMode="rich-text"
        defaultEnableComments={commentsGateEnabled}
        commentsPluginEnabled={commentsGateEnabled}
        onSave={updateDomainPost}
        onUpdateMetadata={updateDomainPostMetadata}
        canEdit={canEdit.allowed || allowOwnerFreshDraftEdit}
        canPublish={canPublish}
      />
    </>
  );
}
