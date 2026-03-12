import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { VIEW_COUNT_META_KEY } from "@/lib/view-count";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  listSiteDataDomains: vi.fn(),
  ensureSiteDomainTypeTables: vi.fn(),
  resetSiteDomainTypeTablesCache: vi.fn(),
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
  resetSiteDomainTypeTablesCache: mocks.resetSiteDomainTypeTablesCache,
  siteTableExists: mocks.siteTableExists,
}));

import {
  countSiteDomainPostUsageByDomain,
  listNetworkDomainPosts,
  listSiteDomainPostMetaMany,
  listSiteDomainPosts,
} from "@/lib/site-domain-post-store";

describe("listSiteDomainPostMetaMany", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();
    mocks.resetSiteDomainTypeTablesCache.mockReset();
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
      rows: [{ domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "9" }],
    });
  });

  it("queries bulk post meta without array-literal binding", async () => {
    const rows = await listSiteDomainPostMetaMany({
      siteId: "site-1",
      dataDomainKey: "post",
      postIds: ["post-1", "post-2"],
      keys: [VIEW_COUNT_META_KEY],
    });

    expect(rows).toEqual([{ domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "9" }]);
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

    expect(rows).toEqual([{ domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "9" }]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("re-ensures site meta tables and retries when pooled reads surface a missing relation", async () => {
    mocks.execute.mockRejectedValueOnce({
      code: "42P01",
      message: 'relation "tooty_site_1_domain_post_meta" does not exist',
    });
    mocks.execute.mockResolvedValueOnce({
      rows: [{ domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "9" }],
    });

    const rows = await listSiteDomainPostMetaMany({
      siteId: "site-1",
      dataDomainKey: "post",
      postIds: ["post-1"],
      keys: [VIEW_COUNT_META_KEY],
    });

    expect(rows).toEqual([{ domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "9" }]);
    expect(mocks.resetSiteDomainTypeTablesCache).toHaveBeenCalledWith("site-1", "post");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it(
    "returns an empty result when meta recovery still cannot resolve the relation",
    async () => {
      mocks.execute.mockRejectedValue({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_post_meta" does not exist',
      });

    const rows = await listSiteDomainPostMetaMany({
      siteId: "site-1",
      dataDomainKey: "post",
      postIds: ["post-1"],
      keys: [VIEW_COUNT_META_KEY],
    });

      expect(rows).toEqual([]);
      expect(mocks.execute).toHaveBeenCalledTimes(8);
    },
    15000,
  );
});

describe("listSiteDomainPosts", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();
    mocks.resetSiteDomainTypeTablesCache.mockReset();
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

describe("listNetworkDomainPosts", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();
    mocks.resetSiteDomainTypeTablesCache.mockReset();
    mocks.siteTableExists.mockReset();

    mocks.siteTableExists.mockResolvedValue(true);
    mocks.ensureSiteDomainTypeTables.mockImplementation(async (_siteId: string, domainKey: string) => ({
      contentTable: `tooty_site_${domainKey}_content`,
      metaTable: `tooty_site_${domainKey}_meta`,
    }));
    mocks.listSiteDataDomains.mockImplementation(async (siteId: string) => {
      if (siteId === "site-bad") {
        throw {
          code: "42P01",
          message: 'relation "tooty_site_bad_domain_post" does not exist',
        };
      }
      return [
        {
          id: 1,
          key: "post",
          label: "Post",
          description: null,
          settings: {},
          isActive: true,
        },
      ];
    });
    mocks.execute.mockResolvedValue({
      rows: [
        {
          id: "post-1",
          title: "Network Post",
          description: "",
          content: "",
          password: "",
          usePassword: false,
          layout: null,
          slug: "network-post",
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

  it("continues when one site still surfaces a missing-relation error under shared load", async () => {
    const rows = await listNetworkDomainPosts({
      siteIds: ["site-good", "site-bad"],
      published: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.siteId).toBe("site-good");
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

  it("re-ensures site content tables and retries when pooled reads surface a missing relation", async () => {
    mocks.execute.mockRejectedValueOnce({
      code: "42P01",
      message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
    });
    mocks.execute.mockResolvedValueOnce({
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

    const rows = await listSiteDomainPosts({
      siteId: "site-1",
      dataDomainKey: "carousel-slide",
      includeInactiveDomains: true,
    });

    expect(rows).toHaveLength(1);
    expect(mocks.resetSiteDomainTypeTablesCache).toHaveBeenCalledWith("site-1", "carousel_slide");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying pooled content relation misses across multiple backends before succeeding", async () => {
    mocks.execute
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockResolvedValueOnce({
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

    const rows = await listSiteDomainPosts({
      siteId: "site-1",
      dataDomainKey: "carousel-slide",
      includeInactiveDomains: true,
    });

    expect(rows).toHaveLength(1);
    expect(mocks.resetSiteDomainTypeTablesCache).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps retrying pooled content relation misses across an extended consistency window", async () => {
    mocks.execute
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      })
      .mockResolvedValueOnce({
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

    const rows = await listSiteDomainPosts({
      siteId: "site-1",
      dataDomainKey: "carousel-slide",
      includeInactiveDomains: true,
    });

    expect(rows).toHaveLength(1);
    expect(mocks.resetSiteDomainTypeTablesCache).toHaveBeenCalledTimes(5);
    expect(mocks.execute).toHaveBeenCalledTimes(6);
  });

  it(
    "skips a domain when content recovery still cannot resolve the relation",
    async () => {
      mocks.execute.mockRejectedValue({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_carousel_slide" does not exist',
      });

    const rows = await listSiteDomainPosts({
      siteId: "site-1",
      dataDomainKey: "carousel-slide",
      includeInactiveDomains: true,
    });

      expect(rows).toEqual([]);
      expect(mocks.execute).toHaveBeenCalledTimes(8);
    },
    15000,
  );
});

describe("countSiteDomainPostUsageByDomain", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.listSiteDataDomains.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();
    mocks.resetSiteDomainTypeTablesCache.mockReset();
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
      contentTable: "tooty_site_1_domain_post",
      metaTable: "tooty_site_1_domain_post_meta",
    });
    mocks.siteTableExists.mockResolvedValue(true);
    mocks.execute.mockResolvedValue({
      rows: [{ count: 4 }],
    });
  });

  it("re-ensures site content tables before falling back on pooled missing relations", async () => {
    mocks.execute.mockRejectedValueOnce({
      code: "42P01",
      message: 'relation "tooty_site_1_domain_post" does not exist',
    });
    mocks.execute.mockResolvedValueOnce({
      rows: [{ count: 4 }],
    });

    const counts = await countSiteDomainPostUsageByDomain("site-1");

    expect(counts.get(1)).toBe(4);
    expect(mocks.resetSiteDomainTypeTablesCache).toHaveBeenCalledWith("site-1", "post");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("retries repeated pooled content misses before usage counting succeeds", async () => {
    mocks.execute
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_post" does not exist',
      })
      .mockRejectedValueOnce({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_post" does not exist',
      })
      .mockResolvedValueOnce({
        rows: [{ count: 4 }],
      });

    const counts = await countSiteDomainPostUsageByDomain("site-1");

    expect(counts.get(1)).toBe(4);
    expect(mocks.resetSiteDomainTypeTablesCache).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it(
    "treats persistently missing pooled content relations as zero usage instead of throwing",
    async () => {
      mocks.execute.mockRejectedValue({
        code: "42P01",
        message: 'relation "tooty_site_1_domain_post" does not exist',
      });

    const counts = await countSiteDomainPostUsageByDomain("site-1");

      expect(counts.get(1)).toBe(0);
      expect(mocks.execute).toHaveBeenCalledTimes(8);
    },
    15000,
  );
});
