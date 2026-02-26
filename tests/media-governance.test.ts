import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  delete: vi.fn(),
  selectWhere: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    select: mocks.select,
    delete: mocks.delete,
  },
}));

describe("media governance cleanup", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.delete.mockReset();
    mocks.selectWhere.mockReset();
    mocks.deleteWhere.mockReset();

    const selectLimit = vi.fn(async () => []);
    const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
    const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    mocks.select.mockReturnValue({ from: selectFrom });
    mocks.selectWhere.mockImplementation(selectWhere);

    const deleteWhere = vi.fn(async () => undefined);
    const deleteWhereWrapper = vi.fn(() => ({ where: deleteWhere }));
    mocks.delete.mockImplementation(deleteWhereWrapper);
    mocks.deleteWhere.mockImplementation(deleteWhere);
  });

  it("returns zero when no rows are eligible", async () => {
    const { purgeOldMediaRecords } = await import("@/lib/media-governance");
    const result = await purgeOldMediaRecords({ olderThanDays: 7, limit: 20, siteId: "site-1" });

    expect(result.deleted).toBe(0);
    expect(result.olderThanDays).toBe(7);
    expect(result.limit).toBe(20);
    expect(result.siteId).toBe("site-1");
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes selected rows when candidates exist", async () => {
    const selectLimit = vi.fn(async () => [{ id: 11 }, { id: 12 }]);
    const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
    const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    mocks.select.mockReturnValueOnce({ from: selectFrom });

    const deleteWhere = vi.fn(async () => undefined);
    mocks.delete.mockImplementationOnce(() => ({ where: deleteWhere }));

    const { purgeOldMediaRecords } = await import("@/lib/media-governance");
    const result = await purgeOldMediaRecords({ olderThanDays: 45, limit: 25 });

    expect(result.deleted).toBe(2);
    expect(result.olderThanDays).toBe(45);
    expect(result.limit).toBe(25);
    expect(result.siteId).toBe(null);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
