import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const existsSync = vi.fn();
  const listen = vi.fn();
  const close = vi.fn((callback?: () => void) => callback?.());
  const on = vi.fn();
  const unref = vi.fn();

  return {
    existsSync,
    listen,
    close,
    on,
    unref,
  };
});

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
  },
}));

vi.mock("node:net", () => ({
  default: {
    createServer: () => ({
      unref: mocks.unref,
      on: mocks.on,
      listen: mocks.listen,
      close: mocks.close,
    }),
  },
}));

describe("resolve-test-port", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.existsSync.mockReset();
    mocks.listen.mockReset();
    mocks.close.mockReset();
    mocks.on.mockReset();
    mocks.unref.mockReset();
    mocks.existsSync.mockReturnValue(false);
    mocks.close.mockImplementation((callback?: () => void) => callback?.());
    mocks.on.mockImplementation((_event: string, _handler: (...args: Array<unknown>) => void) => undefined);
    mocks.listen.mockImplementation((_port: number, _host: string, callback?: () => void) => callback?.());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("increments to the next port when the current slot lock exists", async () => {
    mocks.existsSync.mockImplementation((path: string) => path.includes(".next-test-3123/lock"));

    const { resolveTestPort } = await import("../scripts/resolve-test-port.mjs");

    await expect(resolveTestPort(3123, 3)).resolves.toBe(3124);
    expect(mocks.listen).toHaveBeenCalledWith(3124, "127.0.0.1", expect.any(Function));
  });

  it("increments to the next port when the current harness lock exists", async () => {
    mocks.existsSync.mockImplementation((path: string) => path.includes(".next-playwright-harness-3223/lock"));

    const { resolveTestPort } = await import("../scripts/resolve-test-port.mjs");

    await expect(resolveTestPort(3223, 3)).resolves.toBe(3224);
    expect(mocks.listen).toHaveBeenCalledWith(3224, "127.0.0.1", expect.any(Function));
  });
});
