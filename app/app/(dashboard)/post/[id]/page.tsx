import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Editor from "@/components/editor/editor";
import db from "@/lib/db";
import { getWritingSettings } from "@/lib/cms-config";
import { eq } from "drizzle-orm";
import { postMeta, postTags } from "@/lib/schema";

type Props = {
  params: Promise<{
    id: string
  }>
}
export default async function PostPage({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const id = (await params).id;
  const writing = await getWritingSettings();
  const data = await db.query.posts.findFirst({
    where: (posts, { eq }) => eq(posts.id, decodeURIComponent(id)),
    with: {
      site: {
        columns: {
          subdomain: true,
        },
      },
      categories: {
        columns: {
          categoryId: true,
        },
      },
    },
  });
  if (!data || data.userId !== session.user.id) {
    notFound();
  }

  let tagRows: Array<{ tagId: number }> = [];
  try {
    tagRows = await db.query.postTags.findMany({
      where: eq(postTags.postId, data.id),
      columns: { tagId: true },
    });
  } catch {
    tagRows = [];
  }
  let metaRows: Array<{ key: string; value: string }> = [];
  try {
    metaRows = await db
      .select({
        key: postMeta.key,
        value: postMeta.value,
      })
      .from(postMeta)
      .where(eq(postMeta.postId, data.id));
  } catch {
    metaRows = [];
  }

  const hydratedPost = {
    ...data,
    categories: ((data as any).categories ?? []) as Array<{ categoryId: number }>,
    tags: tagRows,
    meta: metaRows,
  };

  const editorMode = "rich-text";

  return <Editor post={hydratedPost} defaultEditorMode={editorMode} />;
}
