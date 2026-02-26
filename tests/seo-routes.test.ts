import { describe, expect, it, vi } from "vitest";

function missingRelationError() {
  const error = new Error('relation "fernain_cms_settings" does not exist') as Error & { code?: string };
  error.code = "42P01";
  return error;
}

describe("SEO routes schema fallback", () => {
  it("serves sitemap using root URL when settings table is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/fetchers", () => ({
      getAllPosts: vi.fn(async () => []),
    }));
    vi.doMock("@/lib/cms-config", () => ({
      getSiteUrlSetting: vi.fn(async () => {
        throw missingRelationError();
      }),
      getSiteWritingSettings: vi.fn(async () => ({
        permalinkMode: "default",
        singlePattern: "/%domain%/%slug%",
        listPattern: "/%domain_plural%",
        noDomainPrefix: "",
        noDomainDataDomain: "post",
      })),
    }));
    vi.doMock("@/lib/site-url", () => ({
      getRootSiteUrl: vi.fn(() => "https://fallback.example"),
      isLocalHostLike: vi.fn(() => false),
    }));

    const { GET } = await import("@/app/sitemap.xml/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<loc>https://fallback.example</loc>");
  });

  it("sitemap uses domain-aware canonical detail paths for published entries", async () => {
    vi.resetModules();
    vi.doMock("@/lib/fetchers", () => ({
      getAllPosts: vi.fn(async () => [
        {
          slug: "about-this-site",
          dataDomain: "page",
          siteId: "site-1",
          domain: "main.localhost:3000",
          updatedAt: new Date("2026-02-26T00:00:00.000Z"),
        },
      ]),
    }));
    vi.doMock("@/lib/cms-config", () => ({
      getSiteUrlSetting: vi.fn(async () => ({ value: "http://main.localhost:3000" })),
      getSiteWritingSettings: vi.fn(async () => ({
        permalinkMode: "default",
        singlePattern: "/%domain%/%slug%",
        listPattern: "/%domain_plural%",
        noDomainPrefix: "",
        noDomainDataDomain: "post",
      })),
    }));
    vi.doMock("@/lib/site-url", () => ({
      getRootSiteUrl: vi.fn(() => "http://main.localhost:3000"),
      isLocalHostLike: vi.fn(() => true),
    }));

    const { GET } = await import("@/app/sitemap.xml/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<loc>http://main.localhost:3000/page/about-this-site</loc>");
  });

  it("serves robots.txt using defaults when settings table is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/cms-config", () => ({
      getSiteUrlSetting: vi.fn(async () => {
        throw missingRelationError();
      }),
      getBooleanSetting: vi.fn(async () => false),
      SEO_INDEXING_ENABLED_KEY: "seo_indexing_enabled",
    }));
    vi.doMock("@/lib/site-url", () => ({
      getRootSiteUrl: vi.fn(() => "https://fallback.example"),
    }));

    const { GET } = await import("@/app/robots.txt/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://fallback.example/sitemap.xml");
  });
});
