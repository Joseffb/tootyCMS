import { describe, expect, it } from "vitest";
import { shouldResolveThemeQueries } from "@/lib/theme-render-context";

describe("theme render context query laziness", () => {
  it("returns false when template sources do not reference tooty.query", () => {
    expect(
      shouldResolveThemeQueries([
        "<section>{{ site.name }}</section>",
        "{% if auth and auth.logged_in %}Hello {{ auth.display_name }}{% endif %}",
      ]),
    ).toBe(false);
  });

  it("returns true when template references tooty.query via dot notation", () => {
    expect(
      shouldResolveThemeQueries([
        "<ul>{% for item in tooty.query.latest_posts %}<li>{{ item.title }}</li>{% endfor %}</ul>",
      ]),
    ).toBe(true);
  });

  it("returns true when template references tooty.query via bracket notation", () => {
    expect(
      shouldResolveThemeQueries([
        "{{ tooty['query']['latest_posts'] | length }}",
      ]),
    ).toBe(true);
  });
});

