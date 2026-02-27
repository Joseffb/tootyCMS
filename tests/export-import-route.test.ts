import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userCan: vi.fn(),
  createKernelForRequest: vi.fn(),
  listPluginsWithState: vi.fn(),
  listPluginsWithSiteState: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: mocks.userCan,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
  listPluginsWithState: mocks.listPluginsWithState,
  listPluginsWithSiteState: mocks.listPluginsWithSiteState,
}));

describe("POST /api/plugins/export-import", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.userCan.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.listPluginsWithState.mockReset();
    mocks.listPluginsWithSiteState.mockReset();
  });

  it("returns 404 when migration plugin is inactive", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.userCan.mockResolvedValue(true);
    mocks.listPluginsWithState.mockResolvedValue([{ id: "export-import", enabled: false }]);

    const { POST } = await import("@/app/api/plugins/export-import/route");
    const response = await POST(
      new Request("http://localhost/api/plugins/export-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "providers" }),
      }),
    );

    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain("Migration Kit plugin is not active");
  });

  it("routes provider request when migration plugin is active", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.userCan.mockResolvedValue(true);
    mocks.listPluginsWithSiteState.mockResolvedValue([
      { id: "export-import", enabled: true, siteEnabled: true },
    ]);
    const kernel = {
      applyFilters: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, providers: [{ id: "snapshot" }] }), { status: 200 }),
      ),
    };
    mocks.createKernelForRequest.mockResolvedValue(kernel);

    const { POST } = await import("@/app/api/plugins/export-import/route");
    const response = await POST(
      new Request("http://localhost/api/plugins/export-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "providers", siteId: "site_1" }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.providers)).toBe(true);
    expect(kernel.applyFilters).toHaveBeenCalledWith(
      "domain:query",
      null,
      expect.objectContaining({
        name: "export_import.providers",
      }),
    );
  });
});
