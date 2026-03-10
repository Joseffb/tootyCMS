import { describe, expect, it, vi } from "vitest";
import { createSaveQueue, type SaveQueueStatus } from "@/lib/editor-save-queue";

const waitForMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createSaveQueue", () => {
  it("coalesces rapid updates and saves only the latest payload", async () => {
    vi.useFakeTimers();

    const saves: string[] = [];
    const statuses: SaveQueueStatus[] = [];

    const queue = createSaveQueue<string>({
      debounceMs: 100,
      save: async (payload) => {
        saves.push(payload);
      },
      onStatus: ({ status }) => statuses.push(status),
    });

    queue.enqueue("first");
    queue.enqueue("second");
    queue.enqueue("third");

    vi.advanceTimersByTime(100);
    await waitForMicrotasks();

    expect(saves).toEqual(["third"]);
    expect(statuses).toContain("saving");
    expect(statuses.at(-1)).toBe("saved");

    vi.useRealTimers();
  });

  it("runs a second save when new changes arrive during an inflight save", async () => {
    vi.useFakeTimers();

    const saves: string[] = [];
    let releaseFirstSave: (() => void) | null = null;

    const queue = createSaveQueue<string>({
      debounceMs: 0,
      save: async (payload) => {
        saves.push(payload);
        if (payload === "first") {
          await new Promise<void>((resolve) => {
            releaseFirstSave = resolve;
          });
        }
      },
    });

    queue.enqueue("first", { immediate: true });
    await waitForMicrotasks();

    queue.enqueue("second", { immediate: true });
    await waitForMicrotasks();

    expect(saves).toEqual(["first"]);

    releaseFirstSave?.();
    await waitForMicrotasks();

    expect(saves).toEqual(["first", "second"]);

    vi.useRealTimers();
  });

  it("replaces a pending debounced payload when a manual immediate save happens", async () => {
    vi.useFakeTimers();

    const saves: string[] = [];
    const queue = createSaveQueue<string>({
      debounceMs: 100,
      save: async (payload) => {
        saves.push(payload);
      },
    });

    queue.enqueue("stale");
    queue.enqueue("fresh", { immediate: true });
    await waitForMicrotasks();
    vi.advanceTimersByTime(100);
    await waitForMicrotasks();

    expect(saves).toEqual(["fresh"]);

    vi.useRealTimers();
  });

  it("emits error status and recovers on next successful save", async () => {
    vi.useFakeTimers();

    const statuses: SaveQueueStatus[] = [];
    const queue = createSaveQueue<string>({
      debounceMs: 0,
      save: async (payload) => {
        if (payload === "bad") throw new Error("boom");
      },
      onStatus: ({ status }) => statuses.push(status),
    });

    queue.enqueue("bad", { immediate: true });
    await waitForMicrotasks();
    expect(statuses.at(-1)).toBe("error");

    queue.enqueue("good", { immediate: true });
    await waitForMicrotasks();
    expect(statuses.at(-1)).toBe("saved");

    vi.useRealTimers();
  });

  it("flush rejects when the latest attempted save fails", async () => {
    vi.useFakeTimers();

    const queue = createSaveQueue<string>({
      debounceMs: 0,
      save: async () => {
        throw new Error("boom");
      },
    });

    queue.enqueue("bad", { immediate: true });
    await expect(queue.flush()).rejects.toThrow("boom");

    vi.useRealTimers();
  });

  it("flush waits for an inflight save before returning", async () => {
    vi.useFakeTimers();

    const saves: string[] = [];
    let releaseFirstSave: (() => void) | null = null;

    const queue = createSaveQueue<string>({
      debounceMs: 0,
      save: async (payload) => {
        saves.push(payload);
        if (payload === "first") {
          await new Promise<void>((resolve) => {
            releaseFirstSave = resolve;
          });
        }
      },
    });

    queue.enqueue("first", { immediate: true });
    await waitForMicrotasks();

    let flushed = false;
    const flushPromise = queue.flush().then(() => {
      flushed = true;
    });

    await waitForMicrotasks();
    expect(flushed).toBe(false);

    releaseFirstSave?.();
    await flushPromise;

    expect(saves).toEqual(["first"]);
    expect(flushed).toBe(true);

    vi.useRealTimers();
  });
});
