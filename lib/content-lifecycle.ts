import { eq } from "drizzle-orm";
import db from "@/lib/db";
import { domainPosts } from "@/lib/schema";
import { canTransitionContentState, stateFromPublishedFlag } from "@/lib/content-state-engine";
import { emitDomainEvent } from "@/lib/domain-dispatch";

export async function setDomainPostPublishedState(input: {
  postId: string;
  nextPublished: boolean;
  actorType?: "system" | "user" | "admin";
  actorId?: string;
  userId?: string;
}) {
  const post = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, input.postId),
    columns: {
      id: true,
      siteId: true,
      published: true,
      dataDomainId: true,
    },
  });
  if (!post) return { ok: false as const, reason: "not_found" as const };

  const from = stateFromPublishedFlag(Boolean(post.published));
  const to = stateFromPublishedFlag(Boolean(input.nextPublished));
  const allowed = await canTransitionContentState({
    siteId: post.siteId || null,
    from,
    to,
    contentType: "domain",
    contentId: post.id,
    userId: input.userId,
  });
  if (!allowed) return { ok: false as const, reason: "transition_blocked" as const, from, to };
  if (from === to) return { ok: true as const, unchanged: true as const, post };

  const updated = await db
    .update(domainPosts)
    .set({
      published: Boolean(input.nextPublished),
    })
    .where(eq(domainPosts.id, post.id))
    .returning()
    .then((rows) => rows[0] ?? null);
  if (!updated) return { ok: false as const, reason: "not_found" as const };

  if (!post.published && input.nextPublished) {
    await emitDomainEvent({
      version: 1,
      name: "content_published",
      timestamp: new Date().toISOString(),
      siteId: post.siteId || undefined,
      actorType: input.actorType || "system",
      actorId: input.actorId,
      payload: {
        contentType: "domain",
        contentId: post.id,
        dataDomainId: post.dataDomainId,
      },
    });
  }
  return { ok: true as const, post: updated };
}

