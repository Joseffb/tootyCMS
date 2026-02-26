import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  canUserCreateDomainContent: vi.fn(),
  getAllDataDomains: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/authorization", () => ({
  canUserCreateDomainContent: mocks.canUserCreateDomainContent,
}));

vi.mock("@/lib/actions", () => ({
  getAllDataDomains: mocks.getAllDataDomains,
}));

describe("GET /api/data-domains/menu", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.canUserCreateDomainContent.mockReset();
    mocks.getAllDataDomains.mockReset();

    mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.canUserCreateDomainContent.mockResolvedValue(true);
  });

  it("includes post domain and sorts by explicit order then label", async () => {
    mocks.getAllDataDomains.mockResolvedValue([
      { id: 1, key: "page", label: "Page", assigned: true, isActive: true, settings: { menuOrder: 20 } },
      { id: 2, key: "post", label: "Post", assigned: true, isActive: true, settings: { menuOrder: 10 } },
      { id: 3, key: "showcase", label: "Showcase", assigned: true, isActive: true, settings: {} },
    ]);

    const { GET } = await import("@/app/api/data-domains/menu/route");
    const res = await GET(new Request("http://localhost/api/data-domains/menu?siteId=site-1"));
    const json = await res.json();

    expect(json.items.map((item: any) => item.singular)).toEqual(["Post", "Page", "Showcase"]);
    expect(json.items[0].listHref).toBe("/site/site-1/domain/post");
  });
});
