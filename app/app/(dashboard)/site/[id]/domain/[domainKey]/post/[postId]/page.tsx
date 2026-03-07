import Editor from "@/components/editor/editor";
import {
  getSession,
} from "@/lib/auth";
import {
  getSiteDataDomainByKey,
  updateDomainPost,
  updateDomainPostMetadata,
} from "@/lib/actions";
import db from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { canUserMutateDomainPost, userCan } from "@/lib/authorization";
import { getSiteWritingSettings } from "@/lib/cms-config";
import { hasEnabledCommentProvider } from "@/lib/comments-spine";
import { getSiteDomainPostById, listSiteDomainPostMeta } from "@/lib/site-domain-post-store";
import { getSiteTaxonomyTables, withSiteTaxonomyTableRecovery } from "@/lib/site-taxonomy-tables";
import { resolveAuthorizedSiteForAnyCapability } from "@/lib/admin-site-selection";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
    postId: string;
  }>;
};

export default async function DomainPostPage({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id, domainKey, postId } = await params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);
  const resolvedPostId = decodeURIComponent(postId);
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
  const postPromise = getSiteDomainPostById({
    siteId: effectiveSiteId,
    postId: resolvedPostId,
    dataDomainKey: resolvedDomainKey,
  });
  const canEditPromise = canUserMutateDomainPost(session.user.id, resolvedPostId, "edit");

  const [domain, data, canEdit] = await Promise.all([domainPromise, postPromise, canEditPromise]);
  if (!domain) {
    notFound();
  }
  if (!data) {
    notFound();
  }

  const [canRead, canPublish, taxonomyRows, metaRows, writingSettings, commentsPluginEnabled] = await Promise.all([
    data.siteId ? userCan("site.content.read", session.user.id, { siteId: data.siteId }) : Promise.resolve(false),
    data.siteId ? userCan("site.content.publish", session.user.id, { siteId: data.siteId }) : Promise.resolve(false),
    withSiteTaxonomyTableRecovery(effectiveSiteId, async () => {
      const { termsTable, termTaxonomiesTable, termRelationshipsTable } = getSiteTaxonomyTables(effectiveSiteId);
      return db
        .select({
          id: termTaxonomiesTable.id,
          taxonomy: termTaxonomiesTable.taxonomy,
          name: termsTable.name,
        })
        .from(termRelationshipsTable)
        .innerJoin(termTaxonomiesTable, eq(termRelationshipsTable.termTaxonomyId, termTaxonomiesTable.id))
        .innerJoin(termsTable, eq(termTaxonomiesTable.termId, termsTable.id))
        .where(eq(termRelationshipsTable.objectId, data.id));
    }),
    listSiteDomainPostMeta({
      siteId: effectiveSiteId,
      dataDomainKey: resolvedDomainKey,
      postId: data.id,
    }),
    getSiteWritingSettings(effectiveSiteId),
    hasEnabledCommentProvider(effectiveSiteId),
  ]);

  if (!canEdit.allowed && !canRead) {
    notFound();
  }

  const categoryRows = taxonomyRows
    .filter((row) => row.taxonomy === "category")
    .map((row) => ({ categoryId: row.id }));
  const tagRows = taxonomyRows
    .filter((row) => row.taxonomy === "tag")
    .map((row) => ({ tagId: row.id }));

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
    <Editor
      post={hydratedPost}
      defaultEditorMode="rich-text"
      defaultEnableComments={commentsGateEnabled}
      commentsPluginEnabled={commentsGateEnabled}
      onSave={updateDomainPost}
      onUpdateMetadata={updateDomainPostMetadata}
      canEdit={canEdit.allowed}
      canPublish={canPublish}
    />
  );
}
