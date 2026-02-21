# Menu System

Menu system files:

- Runtime and persistence: `lib/menu-system.ts`
- Site settings UI: `app/app/(dashboard)/site/[id]/settings/menus/page.tsx`
- Public rendering usage: `app/[domain]/layout.tsx`, `components/main-header.tsx`

## Purpose

1. Provide predictable navigation locations per site.
2. Allow site-level menu customization without code changes.
3. Let plugins add/modify menu items through filters.

## Menu locations

Current default locations:

- `header`
- `footer`
- `dashboard`

Additional locations can be registered through kernel contracts.

## Menu item shape

```ts
type MenuItem = {
  label: string;
  href: string;
  order?: number;
  external?: boolean;
};
```

## Storage model

Menu payloads are stored as JSON strings in `cms_settings`.

Key format:

- `site_<siteId>_menu_<location>`

Example value:

```json
[
  { "label": "Home", "href": "/", "order": 10 },
  { "label": "About", "href": "/about", "order": 20 },
  { "label": "Docs", "href": "/docs", "order": 30 }
]
```

## Resolution algorithm

1. Read site menu JSON for location.
2. If missing/invalid, fallback to system defaults.
3. Normalize and sort by `order` ascending.
4. Pass result through `nav:items` filter.
5. Render via current theme/component.

## Plugin integration

Plugins should not directly write menu UI state unless they own explicit settings.
Preferred behavior:

1. Append links through `nav:items` filter.
2. Use unique labels/hrefs.
3. Set clear order values to avoid collisions.

Example:

```js
kernel.addFilter("nav:items", (items, ctx) => {
  if (ctx?.location !== "header") return items;
  return [...items, { label: "Plugin Panel", href: "/app/plugins/dev-tools", order: 80 }];
}, 20);
```

## Safety guidance

- Validate JSON before save.
- Ensure hrefs are safe and normalized.
- Keep dashboard menu entries auth-aware in render layers.
