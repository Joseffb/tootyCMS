import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKernel } from "@/lib/kernel";

const {
  createKernelForRequestMock,
  getSessionMock,
  userCanMock,
  traceMock,
} = vi.hoisted(() => ({
  createKernelForRequestMock: vi.fn(),
  getSessionMock: vi.fn(),
  userCanMock: vi.fn(),
  traceMock: vi.fn(),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: createKernelForRequestMock,
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: userCanMock,
}));

vi.mock("@/lib/debug", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/debug")>();
  return {
    ...actual,
    trace: traceMock,
  };
});

import { dispatchPluginRouteRequest } from "@/lib/plugin-routes";

describe("plugin route governance", () => {
  beforeEach(() => {
    createKernelForRequestMock.mockReset();
    getSessionMock.mockReset();
    userCanMock.mockReset();
    traceMock.mockReset();
  });

  it("returns 404 when no governed plugin route is registered", async () => {
    const kernel = createKernel();
    createKernelForRequestMock.mockResolvedValue(kernel);

    const response = await dispatchPluginRouteRequest({
      request: new Request("http://localhost/api/plugins/demo/ping", { method: "GET" }),
      pluginId: "demo",
      slug: ["ping"],
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Not found" });
  });

  it("rejects schema-invalid payloads before handler execution", async () => {
    const kernel = createKernel();
    const handler = vi.fn();
    kernel.registerPluginRoute("demo", {
      namespace: "demo",
      method: "POST",
      path: "/ping",
      auth: "public",
      capability: "public.plugin.demo",
      schema: {
        body: {
          label: { type: "string", required: true, minLength: 2 },
        },
      },
      handler,
    });
    createKernelForRequestMock.mockResolvedValue(kernel);

    const response = await dispatchPluginRouteRequest({
      request: new Request("http://localhost/api/plugins/demo/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "x" }),
      }),
      pluginId: "demo",
      slug: ["ping"],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "body.label must be at least 2 characters",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects authenticated routes without a session", async () => {
    const kernel = createKernel();
    kernel.registerPluginRoute("demo", {
      namespace: "demo",
      method: "GET",
      path: "/secure",
      auth: "required",
      capability: "network.plugins.manage",
      handler: async () => ({ ok: true }),
    });
    createKernelForRequestMock.mockResolvedValue(kernel);
    getSessionMock.mockResolvedValue(null);

    const response = await dispatchPluginRouteRequest({
      request: new Request("http://localhost/api/plugins/demo/secure", { method: "GET" }),
      pluginId: "demo",
      slug: ["secure"],
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Unauthorized" });
  });

  it("rejects when capability checks fail", async () => {
    const kernel = createKernel();
    const handler = vi.fn();
    kernel.registerPluginRoute("demo", {
      namespace: "demo",
      method: "POST",
      path: "/secure",
      auth: "required",
      capability: "site.settings.write",
      schema: {
        body: {
          siteId: { type: "string", required: true },
        },
      },
      handler,
    });
    createKernelForRequestMock.mockResolvedValue(kernel);
    getSessionMock.mockResolvedValue({ user: { id: "user-1", role: "administrator" } });
    userCanMock.mockResolvedValue(false);

    const response = await dispatchPluginRouteRequest({
      request: new Request("http://localhost/api/plugins/demo/secure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: "site-1" }),
      }),
      pluginId: "demo",
      slug: ["secure"],
    });

    expect(userCanMock).toHaveBeenCalledWith("site.settings.write", "user-1", { siteId: "site-1" });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatches through the governed handler and serializes structured returns", async () => {
    const kernel = createKernel();
    const handler = vi.fn(async (ctx) => ({
      ok: true,
      echo: {
        query: ctx.query,
        body: ctx.body,
        userId: ctx.userId,
      },
    }));
    kernel.registerPluginRoute("demo", {
      namespace: "demo",
      method: "POST",
      path: "/secure",
      auth: "admin",
      capability: "network.plugins.manage",
      schema: {
        query: {
          mode: { type: "string", required: true, enum: ["inspect"] },
        },
        body: {
          count: { type: "number", required: true, minimum: 1 },
        },
      },
      handler,
    });
    createKernelForRequestMock.mockResolvedValue(kernel);
    getSessionMock.mockResolvedValue({ user: { id: "user-1", role: "network admin" } });
    userCanMock.mockResolvedValue(true);

    const response = await dispatchPluginRouteRequest({
      request: new Request("http://localhost/api/plugins/demo/secure?mode=inspect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test": "yes" },
        body: JSON.stringify({ count: 2 }),
      }),
      pluginId: "demo",
      slug: ["secure"],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      echo: {
        query: { mode: "inspect" },
        body: { count: 2 },
        userId: "user-1",
      },
    });
    expect(handler).toHaveBeenCalledOnce();
  });
});
