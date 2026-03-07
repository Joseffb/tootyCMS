import { canTransitionContentState, stateFromPublishedFlag } from "@/lib/content-state-engine";
import { emitDomainEvent } from "@/lib/domain-dispatch";
import { findDomainPostForMutation, updateSiteDomainPostById } from "@/lib/site-domain-post-store";

export async function setDomainPostPublishedState(input: {
  postId: string;
  nextPublished: boolean;
  actorType?: "system" | "user" | "admin";
  actorId?: string;
  userId?: string;
}) {
  const post = await findDomainPostForMutation(input.postId);
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

  const updated = await updateSiteDomainPostById({
    siteId: post.siteId,
    postId: post.id,
    dataDomainKey: post.dataDomainKey,
    patch: {
      published: Boolean(input.nextPublished),
    },
  });
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
