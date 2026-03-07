import { describe, expect, it } from "vitest";
import { dynamicRbacRolesTableName } from "@/lib/rbac";

describe("rbac storage contract", () => {
  it("uses the network-scoped RBAC roles table name", () => {
    const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
    const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

    expect(dynamicRbacRolesTableName()).toBe(`${normalizedPrefix}network_rbac_roles`);
    expect(dynamicRbacRolesTableName()).not.toBe(`${normalizedPrefix}rbac_roles`);
  });
});
