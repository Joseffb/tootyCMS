import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDomainPostForMutation: vi.fn(),
  updateSiteDomainPostById: vi.fn(),
  canTransitionContentState: vi.fn(),
  emitDomainEvent: vi.fn(),
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  findDomainPostForMutation: mocks.findDomainPostForMutation,
  updateSiteDomainPostById: mocks.updateSiteDomainPostById,
}));

vi.mock("@/lib/content-state-engine", () => ({
  canTransitionContentState: mocks.canTransitionContentState,
  stateFromPublishedFlag: (published: boolean) => (published ? "published" : "draft"),
}));

vi.mock("@/lib/domain-dispatch", () => ({
  emitDomainEvent: mocks.emitDomainEvent,
}));

import { setDomainPostPublishedState } from "@/lib/content-lifecycle";

describe("content lifecycle service", () => {
  beforeEach(() => {
    mocks.findDomainPostForMutation.mockReset();
    mocks.updateSiteDomainPostById.mockReset();
    mocks.canTransitionContentState.mockReset();
    mocks.emitDomainEvent.mockReset();
  });

  it("blocks when transition engine denies", async () => {
    mocks.findDomainPostForMutation.mockResolvedValue({
      id: "p1",
      siteId: "s1",
      published: false,
      dataDomainId: 1,
      dataDomainKey: "post",
    });
    mocks.canTransitionContentState.mockResolvedValue(false);

    const result = await setDomainPostPublishedState({
      postId: "p1",
      nextPublished: true,
    });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe("transition_blocked");
  });

  it("updates and emits publish lifecycle event", async () => {
    mocks.findDomainPostForMutation.mockResolvedValue({
      id: "p1",
      siteId: "s1",
      published: false,
      dataDomainId: 1,
      dataDomainKey: "post",
    });
    mocks.canTransitionContentState.mockResolvedValue(true);
    mocks.updateSiteDomainPostById.mockResolvedValue({ id: "p1", siteId: "s1", published: true, dataDomainId: 1 });

    const result = await setDomainPostPublishedState({
      postId: "p1",
      nextPublished: true,
      actorType: "admin",
      actorId: "u1",
    });
    expect(result.ok).toBe(true);
    expect(mocks.emitDomainEvent).toHaveBeenCalledTimes(1);
  });
});
