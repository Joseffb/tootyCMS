import { describe, expect, it, vi } from "vitest";
import { register } from "../index.mjs";

describe("tooty-comments plugin", () => {
  it("enqueues the public comments widget through the kernel asset spine", async () => {
    const enqueueScript = vi.fn();
    const createTableBackedProvider = vi.fn(() => ({ id: "tooty-comments" }));
    const registerCommentProvider = vi.fn();
    await register(
      { enqueueScript } as any,
      {
        registerCommentProvider,
        core: {
          comments: {
            createTableBackedProvider,
          },
        },
      } as any,
    );

    expect(enqueueScript).toHaveBeenCalledTimes(1);
    expect(createTableBackedProvider).toHaveBeenCalledWith({
      id: "tooty-comments",
    });
    expect(registerCommentProvider).toHaveBeenCalledWith({
      id: "tooty-comments",
    });
    expect(enqueueScript).toHaveBeenCalledWith({
      id: "tooty-comments-widget",
      src: "/plugin-assets/tooty-comments/comments-widget.js",
    });
  });
});
