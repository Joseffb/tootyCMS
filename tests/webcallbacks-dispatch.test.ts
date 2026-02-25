import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers: Array<any> = [];
  const dbMock = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 1 }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  };
  return {
    handlers,
    dbMock,
    setHandlers(next: any[]) {
      handlers.splice(0, handlers.length, ...next);
    },
  };
});

vi.mock("@/lib/db", () => ({
  default: mocks.dbMock,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: vi.fn(async () => ({
    getAllPluginWebcallbackHandlers: () => mocks.handlers,
  })),
}));

import { dispatchWebcallback } from "@/lib/webcallbacks";

describe("webcallback dispatch", () => {
  beforeEach(() => {
    mocks.setHandlers([]);
    mocks.dbMock.insert.mockClear();
    mocks.dbMock.update.mockClear();
  });

  it("returns 404 when no handler is registered", async () => {
    const result = await dispatchWebcallback({
      handlerId: "missing",
      body: "{}",
      headers: {},
      query: {},
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  it("returns accepted when handler succeeds", async () => {
    mocks.setHandlers([
      {
        pluginId: "plugin-a",
        id: "echo",
        handle: async () => ({ ok: true, status: "processed", response: { accepted: true } }),
      },
    ]);

    const result = await dispatchWebcallback({
      handlerId: "echo",
      body: '{"ok":true}',
      headers: { "x-test": "1" },
      query: { source: "test" },
    });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(202);
  });

  it("returns 500 when handler throws", async () => {
    mocks.setHandlers([
      {
        pluginId: "plugin-a",
        id: "thrower",
        handle: async () => {
          throw new Error("boom");
        },
      },
    ]);

    const result = await dispatchWebcallback({
      handlerId: "thrower",
      body: "{}",
      headers: {},
      query: {},
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
  });
});
