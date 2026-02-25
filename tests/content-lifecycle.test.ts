import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateSetWhereReturning: vi.fn(),
  canTransitionContentState: vi.fn(),
  emitDomainEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      domainPosts: {
        findFirst: mocks.findFirst,
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mocks.updateSetWhereReturning,
        })),
      })),
    })),
  },
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
    mocks.findFirst.mockReset();
    mocks.updateSetWhereReturning.mockReset();
    mocks.canTransitionContentState.mockReset();
    mocks.emitDomainEvent.mockReset();
  });

  it("blocks when transition engine denies", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "p1",
      siteId: "s1",
      published: false,
      dataDomainId: 1,
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
    mocks.findFirst.mockResolvedValue({
      id: "p1",
      siteId: "s1",
      published: false,
      dataDomainId: 1,
    });
    mocks.canTransitionContentState.mockResolvedValue(true);
    mocks.updateSetWhereReturning.mockResolvedValue([
      { id: "p1", siteId: "s1", published: true, dataDomainId: 1 },
    ]);

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

