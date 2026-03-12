import { describe, expect, it } from "vitest";

import { physicalObjectName, sitePhysicalTableName } from "@/lib/site-physical-table-name";

describe("site physical object names", () => {
  it("keeps short object names readable", () => {
    expect(physicalObjectName("tooty_site_demo_domain_post", "pkey")).toBe("tooty_site_demo_domain_post_pkey");
  });

  it("keeps long object names within postgres limits", () => {
    const tableName = sitePhysicalTableName(
      "tooty_test_3123_",
      "e2e_site_lifecycle_shared_load_site_identifier_abcdef123456",
      "domain_post",
    );

    const constraintName = physicalObjectName(tableName, "pkey");
    expect(constraintName.length).toBeLessThanOrEqual(63);
  });

  it("does not collapse distinct long table names to the same object name", () => {
    const postTable = sitePhysicalTableName(
      "tooty_test_3123_",
      "e2e_site_lifecycle_shared_load_site_identifier_abcdef123456",
      "domain_post",
    );
    const pageTable = sitePhysicalTableName(
      "tooty_test_3123_",
      "e2e_site_lifecycle_shared_load_site_identifier_abcdef123456",
      "domain_page",
    );

    expect(physicalObjectName(postTable, "pkey")).not.toBe(physicalObjectName(pageTable, "pkey"));
  });
});
