import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      users: {
        findFirst: mocks.userFindFirst,
      },
    },
    execute: mocks.execute,
  },
}));

describe("site user tables", () => {
  beforeEach(() => {
    mocks.userFindFirst.mockReset();
    mocks.execute.mockReset();
  });

  it("does not write site user role when parent user row is missing", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    const { upsertSiteUserRole } = await import("@/lib/site-user-tables");

    await upsertSiteUserRole("site-1", "missing-user", "author");

    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

