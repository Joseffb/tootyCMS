import { describe, expect, it } from "vitest";
import { hydrateCommentsSlotMarkup } from "@/lib/comments-slot-bootstrap";

describe("hydrateCommentsSlotMarkup", () => {
  it("injects a visible comments shell into empty tooty comment slots", () => {
    const html =
      '<section><div data-theme-slot="comments" class="tooty-comments-block" data-tooty-comments data-comments-block data-site-id="site-1" data-context-id="post-1"></div></section>';

    const output = hydrateCommentsSlotMarkup(html, {
      commentsVisibleToPublic: true,
      canPostAuthenticated: true,
      canPostAnonymously: true,
      anonymousIdentityFields: { name: true, email: true },
    });

    expect(output).toContain("tooty-comments-title");
    expect(output).toContain('data-comments-bootstrap-ready="true"');
    expect(output).toContain('data-can-post-anonymously="true"');
    expect(output).toContain('data-anonymous-email-required="true"');
    expect(output).toContain('data-comments-form');
  });

  it("leaves unrelated html untouched", () => {
    const html = "<section><p>No comments slot here.</p></section>";

    expect(
      hydrateCommentsSlotMarkup(html, {
        commentsVisibleToPublic: false,
        canPostAuthenticated: false,
        canPostAnonymously: false,
        anonymousIdentityFields: { name: false, email: false },
      }),
    ).toBe(html);
  });
});
