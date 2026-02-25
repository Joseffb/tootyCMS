import { describe, expect, it, vi } from "vitest";
import { canTransitionContentState, stateFromPublishedFlag } from "@/lib/content-state-engine";

const mocks = vi.hoisted(() => ({
  applyFilters: vi.fn(async (_name: string, value: unknown) => value),
  registerContentState: vi.fn(),
  registerContentTransition: vi.fn(),
  getContentStates: vi.fn(() => [
    { key: "draft", label: "Draft", transitions: ["publish"] },
    { key: "published", label: "Published", transitions: ["unpublish"] },
  ]),
  getContentTransitions: vi.fn(() => [
    { key: "publish", label: "Publish", to: "published" },
    { key: "unpublish", label: "Unpublish", to: "draft" },
  ]),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: vi.fn(async () => ({
    applyFilters: mocks.applyFilters,
    registerContentState: mocks.registerContentState,
    registerContentTransition: mocks.registerContentTransition,
    getContentStates: mocks.getContentStates,
    getContentTransitions: mocks.getContentTransitions,
  })),
}));

describe("content state engine", () => {
  it("maps published flag to default states", () => {
    expect(stateFromPublishedFlag(true)).toBe("published");
    expect(stateFromPublishedFlag(false)).toBe("draft");
  });

  it("allows default draft -> published transition", async () => {
    const allowed = await canTransitionContentState({
      from: "draft",
      to: "published",
      contentType: "domain",
      contentId: "post_1",
    });
    expect(allowed).toBe(true);
  });

  it("blocks unsupported default transition", async () => {
    const allowed = await canTransitionContentState({
      from: "draft",
      to: "archived",
      contentType: "domain",
      contentId: "post_1",
    });
    expect(allowed).toBe(false);
  });

  it("supports plugin veto via content:transition:decision filter", async () => {
    mocks.applyFilters.mockImplementation(async (name: string, value: unknown) => {
      if (name === "content:transition:decision") return false;
      return value;
    });
    const allowed = await canTransitionContentState({
      from: "draft",
      to: "published",
      contentType: "domain",
      contentId: "post_1",
    });
    expect(allowed).toBe(false);
  });
});

