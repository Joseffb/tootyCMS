import { describe, expect, it } from "vitest";
import { renderThemeTemplate } from "@/lib/theme-template";

describe("theme menu partial rendering", () => {
  it("renders location menus through theme menu and menu-item partials", () => {
    const html = renderThemeTemplate("{{ theme_header | safe }}", {
      theme_header: "{{ tooty.renderedMenus.header | safe }}",
      theme_menu: "<nav data-menu='{{ menu_location }}'>{{ rendered_items | safe }}</nav>",
      theme_menu_item:
        "<a data-depth='{{ depth }}' href='{{ menu_item.href }}'>{{ menu_item.label or menu_item.title }}</a>{% if has_children %}<div class='children'>{{ children_html | safe }}</div>{% endif %}",
      tooty: {
        menuLocations: {
          header: {
            key: "homepage",
            title: "Homepage",
            location: "header",
            items: [
              {
                id: "item-1",
                title: "Homepage",
                label: "Homepage",
                href: "/",
                description: "",
                image: "",
                mediaId: "",
                target: "",
                rel: "",
                external: false,
                enabled: true,
                sortOrder: 10,
                order: 10,
                meta: {},
                children: [
                  {
                    id: "item-2",
                    title: "Posts",
                    label: "Posts",
                    href: "/posts",
                    description: "Latest posts",
                    image: "",
                    mediaId: "",
                    target: "",
                    rel: "",
                    external: false,
                    enabled: true,
                    sortOrder: 20,
                    order: 20,
                    meta: {},
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(html).toContain("data-menu='header'");
    expect(html).toContain("href='/'");
    expect(html).toContain("href='/posts'");
    expect(html).toContain("data-depth='1'");
  });

  it("prefers location-specific menu partials when provided", () => {
    const html = renderThemeTemplate("{{ theme_header | safe }}", {
      theme_header: "{{ tooty.renderedMenus.header | safe }}",
      theme_menu: "<nav data-menu='default'>{{ rendered_items | safe }}</nav>",
      theme_menu_item: "<span>default-{{ menu_item.label }}</span>",
      theme_menu_header: "<nav data-menu='header-specific'>{{ rendered_items | safe }}</nav>",
      theme_menu_item_header: "<span>header-{{ menu_item.label }}</span>",
      tooty: {
        menuLocations: {
          header: {
            key: "homepage",
            title: "Homepage",
            location: "header",
            items: [
              {
                id: "item-1",
                title: "Homepage",
                label: "Homepage",
                href: "/",
                description: "",
                image: "",
                mediaId: "",
                target: "",
                rel: "",
                external: false,
                enabled: true,
                sortOrder: 10,
                order: 10,
                meta: {},
              },
            ],
          },
        },
      },
    });

    expect(html).toContain("data-menu='header-specific'");
    expect(html).toContain("header-Homepage");
    expect(html).not.toContain("default-Homepage");
  });

  it("prefers menu-key-specific partials over location partials when provided", () => {
    const html = renderThemeTemplate("{{ theme_header | safe }}", {
      theme_header: "{{ tooty.renderedMenus.header | safe }}",
      theme_menu: "<nav data-menu='default'>{{ rendered_items | safe }}</nav>",
      theme_menu_item: "<span>default-{{ menu_item.label }}</span>",
      theme_menu_header: "<nav data-menu='header-specific'>{{ rendered_items | safe }}</nav>",
      theme_menu_item_header: "<span>header-{{ menu_item.label }}</span>",
      theme_menu_by_location_and_key: {
        header: {
          homepage: "<nav data-menu='header-homepage'>{{ rendered_items | safe }}</nav>",
        },
      },
      theme_menu_item_by_location_and_key: {
        header: {
          homepage: "<span>homepage-{{ menu_item.label }}</span>",
        },
      },
      tooty: {
        menuLocations: {
          header: {
            key: "homepage",
            title: "Homepage",
            location: "header",
            items: [
              {
                id: "item-1",
                title: "Homepage",
                label: "Homepage",
                href: "/",
                description: "",
                image: "",
                mediaId: "",
                target: "",
                rel: "",
                external: false,
                enabled: true,
                sortOrder: 10,
                order: 10,
                meta: {},
              },
            ],
          },
        },
      },
    });

    expect(html).toContain("data-menu='header-homepage'");
    expect(html).toContain("homepage-Homepage");
    expect(html).not.toContain("header-Homepage");
  });

  it("renders legacy location arrays through menu partials when menuLocations are absent", () => {
    const html = renderThemeTemplate("{{ theme_header | safe }}", {
      theme_header: "{{ tooty.renderedMenus.header | safe }}",
      theme_menu: "<nav data-menu='{{ menu_location }}' data-key='{{ menu.key }}'>{{ rendered_items | safe }}</nav>",
      theme_menu_item:
        "<a data-depth='{{ depth }}' href='{{ menu_item.href }}'>{{ menu_item.label or menu_item.title }}</a>{% if has_children %}<div class='children'>{{ children_html | safe }}</div>{% endif %}",
      tooty: {
        menus: {
          header: [
            {
              id: "item-1",
              title: "Homepage",
              label: "Homepage",
              href: "/",
              description: "",
              image: "",
              mediaId: "",
              target: "",
              rel: "",
              external: false,
              enabled: true,
              sortOrder: 10,
              order: 10,
              meta: {},
              children: [
                {
                  id: "item-2",
                  title: "Posts",
                  label: "Posts",
                  href: "/posts",
                  description: "",
                  image: "",
                  mediaId: "",
                  target: "",
                  rel: "",
                  external: false,
                  enabled: true,
                  sortOrder: 20,
                  order: 20,
                  meta: {},
                },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain("data-menu='header'");
    expect(html).toContain("data-key='header'");
    expect(html).toContain("href='/'");
    expect(html).toContain("href='/posts'");
    expect(html).toContain("data-depth='1'");
  });

  it("renders theme.excerpt with a continuation link for the active post", () => {
    const html = renderThemeTemplate("{{ theme.excerpt(5, '...') | safe }}", {
      post: {
        href: "/post/welcome",
        content:
          "One two three four five six seven eight nine ten eleven twelve.",
      },
    });

    expect(html).toContain('class="theme-excerpt__text"');
    expect(html).toContain("One two three four five");
    expect(html).toContain('class="theme-excerpt__more"');
    expect(html).toContain('href="/post/welcome"');
    expect(html).toContain(">...</a>");
  });

  it("attaches excerpt helpers to archive post items", () => {
    const html = renderThemeTemplate(
      "{% for post in posts %}<article>{{ post.excerpt(4, 'More') | safe }}</article>{% endfor %}",
      {
        posts: [
          {
            href: "/post/archive-item",
            content: "Alpha beta gamma delta epsilon zeta eta theta.",
          },
        ],
      },
    );

    expect(html).toContain("Alpha beta gamma delta");
    expect(html).toContain('class="theme-excerpt__more"');
    expect(html).toContain(">More</a>");
  });
});
