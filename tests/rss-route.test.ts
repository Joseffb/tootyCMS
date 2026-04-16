import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSiteData: vi.fn(),
  getDomainPostsForSite: vi.fn(),
  getEffectiveSiteRssSettings: vi.fn(),
  getSiteUrlSettingForSite: vi.fn(),
  getSiteWritingSettings: vi.fn(),
  getSitePublicUrl: vi.fn(),
  toThemePostHtml: vi.fn(),
}));

vi.mock("@/lib/fetchers", () => ({
  getSiteData: mocks.getSiteData,
  getDomainPostsForSite: mocks.getDomainPostsForSite,
}));

vi.mock("@/lib/cms-config", () => ({
  getEffectiveSiteRssSettings: mocks.getEffectiveSiteRssSettings,
  getSiteUrlSettingForSite: mocks.getSiteUrlSettingForSite,
  getSiteWritingSettings: mocks.getSiteWritingSettings,
}));

vi.mock("@/lib/site-url", () => ({
  getSitePublicUrl: mocks.getSitePublicUrl,
}));

vi.mock("@/lib/theme-post-html", () => ({
  toThemePostHtml: mocks.toThemePostHtml,
}));

type RouteState = {
  site: {
    id: string;
    name: string;
    description: string;
    heroSubtitle?: string | null;
    subdomain?: string | null;
    customDomain?: string | null;
    isPrimary?: boolean;
  } | null;
  rss: {
    networkEnabled: boolean;
    enabled: boolean;
    contentMode: "excerpt" | "full";
    itemsPerFeed: number;
    includedDomainKeys: string[];
  };
  siteUrl: string;
  writing: {
    permalinkMode: "default" | "custom";
    singlePattern: string;
    listPattern: string;
    noDomainPrefix: string;
    noDomainDataDomain: string;
  };
  postsByDomain: Record<string, Array<{
    id: string;
    title: string;
    description: string;
    content: string;
    slug: string;
    createdAt: Date;
  }>>;
};

let state: RouteState;

describe("RSS feed route", () => {
  beforeEach(() => {
    vi.resetModules();
    state = {
      site: {
        id: "site-1",
        name: "Example Site",
        description: "Example description",
        heroSubtitle: "Latest writing from Example Site",
        subdomain: "main",
        customDomain: "example.com",
        isPrimary: true,
      },
      rss: {
        networkEnabled: true,
        enabled: true,
        contentMode: "excerpt",
        itemsPerFeed: 10,
        includedDomainKeys: ["post"],
      },
      siteUrl: "https://example.com",
      writing: {
        permalinkMode: "default",
        singlePattern: "/%domain%/%slug%",
        listPattern: "/%domain_plural%",
        noDomainPrefix: "",
        noDomainDataDomain: "post",
      },
      postsByDomain: {
        post: [
          {
            id: "post-1",
            title: "Welcome",
            description: "Hello summary",
            content: "Welcome body",
            slug: "welcome",
            createdAt: new Date("2026-04-10T00:00:00.000Z"),
          },
        ],
      },
    };

    mocks.getSiteData.mockReset();
    mocks.getDomainPostsForSite.mockReset();
    mocks.getEffectiveSiteRssSettings.mockReset();
    mocks.getSiteUrlSettingForSite.mockReset();
    mocks.getSiteWritingSettings.mockReset();
    mocks.getSitePublicUrl.mockReset();
    mocks.toThemePostHtml.mockReset();

    mocks.getSiteData.mockImplementation(async () => state.site);
    mocks.getDomainPostsForSite.mockImplementation(async (_host: string, dataDomainKey: string) => state.postsByDomain[dataDomainKey] || []);
    mocks.getEffectiveSiteRssSettings.mockImplementation(async () => state.rss);
    mocks.getSiteUrlSettingForSite.mockImplementation(async () => ({ value: state.siteUrl }));
    mocks.getSiteWritingSettings.mockImplementation(async () => state.writing);
    mocks.getSitePublicUrl.mockImplementation(() => state.siteUrl);
    mocks.toThemePostHtml.mockImplementation((raw: unknown) => `<p>${String(raw || "")}</p>`);
  });

  it("returns 404 when network RSS is disabled", async () => {
    state.rss.networkEnabled = false;

    const { GET } = await import("@/app/feed.xml/route");
    const response = await GET(new Request("https://example.com/feed.xml", { headers: { host: "example.com" } }));

    expect(response.status).toBe(404);
  });

  it("returns 404 when the site RSS setting is disabled", async () => {
    state.rss.enabled = false;

    const { GET } = await import("@/app/feed.xml/route");
    const response = await GET(new Request("https://example.com/feed.xml", { headers: { host: "example.com" } }));

    expect(response.status).toBe(404);
  });

  it("serves RSS XML in excerpt mode without full-body payloads", async () => {
    const { GET } = await import("@/app/feed.xml/route");
    const response = await GET(new Request("https://example.com/feed.xml", { headers: { host: "example.com" } }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/rss+xml");
    expect(body).toContain("<title>Example Site</title>");
    expect(body).toContain("<link>https://example.com</link>");
    expect(body).toContain("<description>Hello summary</description>");
    expect(body).not.toContain("<content:encoded>");
    expect(body).toContain('rel="self" type="application/rss+xml"');
  });

  it("includes content:encoded in full-content mode", async () => {
    state.rss.contentMode = "full";

    const { GET } = await import("@/app/feed.xml/route");
    const response = await GET(new Request("https://example.com/feed.xml", { headers: { host: "example.com" } }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<content:encoded><![CDATA[<p>Welcome body</p>]]></content:encoded>");
  });

  it("uses canonical item URLs based on site permalink settings", async () => {
    state.writing = {
      permalinkMode: "custom",
      singlePattern: "/updates/%slug%",
      listPattern: "/updates",
      noDomainPrefix: "",
      noDomainDataDomain: "post",
    };

    const { GET } = await import("@/app/feed.xml/route");
    const response = await GET(new Request("https://example.com/feed.xml", { headers: { host: "example.com" } }));
    const body = await response.text();

    expect(body).toContain("<link>https://example.com/updates/welcome</link>");
    expect(body).toContain("<guid isPermaLink=\"true\">https://example.com/updates/welcome</guid>");
  });

  it("merges included domains, sorts newest-first, and enforces the item limit", async () => {
    state.rss.itemsPerFeed = 2;
    state.rss.includedDomainKeys = ["post", "page"];
    state.postsByDomain = {
      post: [
        {
          id: "post-older",
          title: "Older Post",
          description: "",
          content: "Older body",
          slug: "older-post",
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
        },
        {
          id: "post-newer",
          title: "Newer Post",
          description: "",
          content: "Newer body",
          slug: "newer-post",
          createdAt: new Date("2026-04-08T00:00:00.000Z"),
        },
      ],
      page: [
        {
          id: "page-latest",
          title: "Latest Page",
          description: "",
          content: "Latest page body",
          slug: "latest-page",
          createdAt: new Date("2026-04-12T00:00:00.000Z"),
        },
      ],
    };

    const { GET } = await import("@/app/feed.xml/route");
    const response = await GET(new Request("https://example.com/feed.xml", { headers: { host: "example.com" } }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.match(/<item>/g)).toHaveLength(2);
    expect(body.indexOf("<title>Latest Page</title>")).toBeLessThan(body.indexOf("<title>Newer Post</title>"));
    expect(body).not.toContain("<title>Older Post</title>");
  });
});
