import { describe, expect, it, vi } from "vitest";
import { register } from "../index.mjs";

describe("tooty-comments plugin", () => {
  it("registers the provider, enqueues the widget, and exposes a generic theme slot", async () => {
    const enqueueScript = vi.fn();
    const addFilter = vi.fn();
    const createTableBackedProvider = vi.fn(() => ({ id: "tooty-comments" }));
    const registerCommentProvider = vi.fn();
    const getSetting = vi.fn().mockResolvedValue("true");
    await register(
      { enqueueScript, addFilter } as any,
      {
        getSetting,
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
    expect(addFilter).toHaveBeenCalledWith(
      "theme:slots",
      expect.any(Function),
    );
    expect(enqueueScript).toHaveBeenCalledWith({
      id: "tooty-comments-widget",
      src: "/plugin-assets/tooty-comments/comments-widget.js",
    });

    const themeSlotsFilter = addFilter.mock.calls[0]?.[1];
    const slots = await themeSlotsFilter(
      {},
      {
        routeKind: "domain_detail",
        siteId: "site-1",
        entry: {
          id: "entry-1",
          meta: [{ key: "use_comments", value: "true" }],
        },
      },
    );

    expect(getSetting).toHaveBeenCalledWith("enable_comments", "true");
    expect(slots.comments).toContain('data-theme-slot="comments"');
    expect(slots.comments).toContain('data-site-id="site-1"');
    expect(slots.comments).toContain('data-context-id="entry-1"');
  });
});
