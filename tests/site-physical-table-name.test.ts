import { describe, expect, it } from "vitest";
import { siteIdentityToken, sitePhysicalSequenceName, sitePhysicalTableName } from "@/lib/site-physical-table-name";

describe("site physical table naming", () => {
  it("keeps readable site_{id}_{suffix} names when under postgres identifier limits", () => {
    const table = sitePhysicalTableName("tooty_", "p9rd7cso8a4swmekqcroo5ha", "settings");
    expect(table).toBe("tooty_site_p9rd7cso8a4swmekqcroo5ha_settings");
    expect(table.length).toBeLessThanOrEqual(63);
  });

  it("compacts long site ids with a stable hash and preserves suffix to avoid cross-table collisions", () => {
    const siteId = "e2e-comments-auth-3f930883-2582-45f4-872f-9e8926490d3a-site";
    const commentsTable = sitePhysicalTableName("tooty_", siteId, "comments");
    const metaTable = sitePhysicalTableName("tooty_", siteId, "comment_meta");

    expect(commentsTable).not.toBe(metaTable);
    expect(commentsTable.endsWith("_comments")).toBe(true);
    expect(metaTable.endsWith("_comment_meta")).toBe(true);
    expect(commentsTable.length).toBeLessThanOrEqual(63);
    expect(metaTable.length).toBeLessThanOrEqual(63);
  });

  it("builds distinct hashed sequence names for long site-scoped serial resources", () => {
    const siteA = "e2e-comments-auth-3f930883-2582-45f4-872f-9e8926490d3a-site";
    const siteB = "e2e-comments-auth-3f930883-2582-45f4-872f-9e8926490d3b-site";
    const sequenceA = sitePhysicalSequenceName("tooty_", siteA, "menu_item_meta_id_seq");
    const sequenceB = sitePhysicalSequenceName("tooty_", siteB, "menu_item_meta_id_seq");

    expect(sequenceA).not.toBe(sequenceB);
    expect(sequenceA.endsWith("_menu_item_meta_id_seq")).toBe(true);
    expect(sequenceB.endsWith("_menu_item_meta_id_seq")).toBe(true);
    expect(sequenceA.length).toBeLessThanOrEqual(63);
    expect(sequenceB.length).toBeLessThanOrEqual(63);
  });

  it("normalizes site identity tokens", () => {
    expect(siteIdentityToken(" site-id.with*symbols ")).toBe("site_id_with_symbols");
    expect(() => siteIdentityToken("")).toThrowError("siteId is required.");
  });
});
