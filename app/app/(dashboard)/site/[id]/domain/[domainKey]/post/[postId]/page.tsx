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
import { domainPostMeta, domainPosts, termRelationships, termTaxonomies, terms } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { canUserMutateDomainPost, userCan } from "@/lib/authorization";
import { getSiteWritingSettings } from "@/lib/cms-config";
import { hasEnabledCommentProvider } from "@/lib/comments-spine";

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

  const domain = await getSiteDataDomainByKey(siteId, resolvedDomainKey);
  if (!domain) {
    notFound();
  }

  const data = await db.query.domainPosts.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, resolvedPostId),
        eq(table.siteId, siteId),
        eq(table.dataDomainId, domain.id),
      ),
    with: {
      site: {
        columns: {
          subdomain: true,
        },
      },
    },
  });
  if (!data) {
    notFound();
  }
  const canEdit = await canUserMutateDomainPost(session.user.id, resolvedPostId, "edit");
  const canRead = data.siteId
    ? await userCan("site.content.read", session.user.id, { siteId: data.siteId })
    : false;
  const canPublish = data.siteId
    ? await userCan("site.content.publish", session.user.id, { siteId: data.siteId })
    : false;
  if (!canEdit.allowed && !canRead) {
    notFound();
  }

  const taxonomyRows = await db
    .select({
      id: termTaxonomies.id,
      taxonomy: termTaxonomies.taxonomy,
      name: terms.name,
    })
    .from(termRelationships)
    .innerJoin(termTaxonomies, eq(termRelationships.termTaxonomyId, termTaxonomies.id))
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(eq(termRelationships.objectId, data.id));

  const categoryRows = taxonomyRows
    .filter((row) => row.taxonomy === "category")
    .map((row) => ({ categoryId: row.id }));
  const tagRows = taxonomyRows
    .filter((row) => row.taxonomy === "tag")
    .map((row) => ({ tagId: row.id }));

  const metaRows = await db
    .select({
      key: domainPostMeta.key,
      value: domainPostMeta.value,
    })
    .from(domainPostMeta)
    .where(eq(domainPostMeta.domainPostId, data.id));

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
  const writingSettings = await getSiteWritingSettings(siteId);
  const commentsPluginEnabled = await hasEnabledCommentProvider(siteId);
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
