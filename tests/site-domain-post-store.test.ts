import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  listSiteDataDomains: vi.fn(),
  ensureSiteDomainTypeTables: vi.fn(),
  siteTableExists: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: mocks.execute,
  },
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  listSiteDataDomains: mocks.listSiteDataDomains,
}));

vi.mock("@/lib/site-domain-type-tables", () => ({
  ensureSiteDomainTypeTables: mocks.ensureSiteDomainTypeTables,
  siteTableExists: mocks.siteTableExists,
}));

import { listSiteDomainPostMetaMany, listSiteDomainPosts } from "@/lib/site-domain-post-store";

describe("listSiteDomainPostMetaMany", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();
    mocks.siteTableExists.mockReset();

    mocks.listSiteDataDomains.mockResolvedValue([
      {
        id: 1,
        key: "post",
        label: "Posts",
        description: null,
        settings: {},
        isActive: true,
      },
    ]);
    mocks.ensureSiteDomainTypeTables.mockResolvedValue({
      contentTable: "tooty_site_1_domain_posts",
      metaTable: "tooty_site_1_domain_post_meta",
    });
    mocks.siteTableExists.mockResolvedValue(true);
    mocks.execute.mockResolvedValue({
      rows: [{ domainPostId: "post-1", key: "view_count", value: "9" }],
    });
  });

  it("queries bulk post meta without array-literal binding", async () => {
    const rows = await listSiteDomainPostMetaMany({
      siteId: "site-1",
      dataDomainKey: "post",
      postIds: ["post-1", "post-2"],
      keys: ["view_count"],
    });

    expect(rows).toEqual([{ domainPostId: "post-1", key: "view_count", value: "9" }]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = mocks.execute.mock.calls[0]?.[0];
    const dialect = new PgDialect();
    const compiled = dialect.sqlToQuery(query);
    expect(compiled.sql).toContain('"domainPostId" IN (');
    expect(compiled.sql).toContain('"key" IN (');
    expect(compiled.sql).not.toContain("ANY(");
    expect(compiled.params.some((value) => Array.isArray(value))).toBe(false);
  });

  it("normalizes hyphenated plugin domain keys when listing bulk meta", async () => {
    mocks.listSiteDataDomains.mockResolvedValue([
      {
        id: 2,
        key: "carousel_slide",
        label: "Carousel Slide",
        description: null,
        settings: {},
        isActive: true,
      },
    ]);
    mocks.ensureSiteDomainTypeTables.mockResolvedValue({
      contentTable: "tooty_site_1_domain_carousel_slide",
      metaTable: "tooty_site_1_domain_carousel_slide_meta",
    });

    const rows = await listSiteDomainPostMetaMany({
      siteId: "site-1",
      dataDomainKey: "carousel-slide",
      postIds: ["slide-1"],
      keys: ["carousel_id"],
    });

    expect(rows).toEqual([{ domainPostId: "post-1", key: "view_count", value: "9" }]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});

describe("listSiteDomainPosts", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();
    mocks.siteTableExists.mockReset();

    mocks.listSiteDataDomains.mockResolvedValue([
      {
        id: 2,
        key: "carousel_slide",
        label: "Carousel Slide",
        description: null,
        settings: {},
        isActive: true,
      },
    ]);
    mocks.ensureSiteDomainTypeTables.mockResolvedValue({
      contentTable: "tooty_site_1_domain_carousel_slide",
      metaTable: "tooty_site_1_domain_carousel_slide_meta",
    });
    mocks.siteTableExists.mockResolvedValue(true);
    mocks.execute.mockResolvedValue({
      rows: [
        {
          id: "slide-1",
          title: "Slide One",
          description: "",
          content: "",
          password: "",
          usePassword: false,
          layout: null,
          slug: "slide-one",
          image: "",
          imageBlurhash: "",
          published: true,
          userId: "user-1",
          createdAt: new Date("2026-03-06T00:00:00.000Z"),
          updatedAt: new Date("2026-03-06T00:00:00.000Z"),
        },
      ],
    });
  });

  it("normalizes hyphenated plugin domain keys when listing posts", async () => {
    const rows = await listSiteDomainPosts({
      siteId: "site-1",
      dataDomainKey: "carousel-slide",
      includeInactiveDomains: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataDomainKey).toBe("carousel_slide");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
