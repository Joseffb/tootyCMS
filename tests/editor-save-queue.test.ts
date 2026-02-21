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
});
