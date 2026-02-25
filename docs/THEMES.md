# Theme System

Theme system files:

- Runtime/discovery/state: `lib/themes.ts`
- Theme manifests: `themes/<theme-id>/theme.json`
- Global theme settings UI: `app/app/(dashboard)/settings/themes/page.tsx`
- Site theme selection UI: `app/app/(dashboard)/site/[id]/settings/themes/page.tsx`

Theme root path:
- Default: `themes/`
- Override: `THEMES_PATH` (absolute or workspace-relative path)

## Purpose

1. Keep visual customization simple and token-based.
2. Allow drop-in theme folders without rebuilding architecture.
3. Preserve deterministic styling in serverless/Vercel environments.
4. Keep CMS render logic theme-sandboxed (see `docs/THEME_SANDBOX_CONTRACT.md`).

## Drop-in manifest

`theme.json` is required per theme folder.

```json
{
  "id": "tooty-light",
  "name": "Tooty Light",
  "description": "Warm pastel beige defaults",
  "version": "1.0.0",
  "tokens": {
    "shellBg": "bg-[#f3e8d0]",
    "shellText": "text-stone-900",
    "topMuted": "text-stone-600",
    "titleText": "text-stone-900",
    "navText": "text-stone-700",
    "navHover": "hover:text-orange-600"
  },
  "settingsFields": [
    { "key": "heroBadge", "label": "Hero Badge", "type": "text" }
  ]
}
```

## Theme settings fields

Supported field types:

- `text`
- `textarea`
- `password`
- `number`
- `checkbox`

These fields are optional and theme-specific. Values are persisted in:

- `theme_<themeId>_config`

## System Primaries (Decision Keys)

Theme config is normalized with a baseline set of primaries so theme decisions always have stable keys.

Source: `lib/themes.ts` (`SYSTEM_THEME_PRIMARIES`).

Defaults:

- `documentation_category_slug`: `documentation`
- `post_mascot_mode`: `none`
- `category_base`: `c`
- `tag_base`: `t`

Notes:

- `post_mascot_mode` allowed values: `none`, `fixed_reading`, `random_non_docs`.
- `documentation_category_slug`, `category_base`, and `tag_base` are normalized to lowercase and fallback to defaults when empty.
- Theme config returned by `listThemesWithState()` already includes these normalized primaries, even if not explicitly saved yet.

## Template Primaries

Theme templates receive baseline primary variables at top-level and inside `system`.

Available keys:

- `data_domain` (example default: `post`)
- `route_kind` (example: `home`)
- `category_base` (default: `c`)
- `tag_base` (default: `t`)
- `site_id`
- `site_domain`

Example conditional:

```njk
{% if data_domain == "used-cars" %}
  <section>Used Cars Layout</section>
{% endif %}
```

## Runtime Boot Context

Boot path for theme templates:

1. Domain request resolves site (`app/[domain]/page.tsx`).
2. Active theme/template is loaded (`lib/theme-runtime.ts`).
3. Theme payload is rendered by Nunjucks (`lib/theme-template.ts`).
4. Canonical `system` context is normalized (`lib/theme-system-context.ts`).

Canonical `system` object:

- `system.route_kind`
- `system.data_domain`
- `system.category_base`
- `system.tag_base`
- `system.site_id`
- `system.site_domain`
- `system.site_subdomain`
- `system.site_is_primary`
- `system.theme_id`
- `system.theme_name`

For convenience, these are also exposed as top-level aliases (`route_kind`, `data_domain`, etc.).

## Canonical Normalization Guarantees

`buildThemeSystemContext()` enforces a stable shape before render:

- missing route fields get defaults (`route_kind=home`, `data_domain=post`)
- base paths are normalized (`category_base`, `tag_base`)
- site/domain/theme identifiers are always present as strings (empty-string fallback)
- both `system.*` and top-level aliases are injected into Nunjucks context in `renderThemeTemplate()`

This means templates can rely on `system` keys without per-route guards.

## Default Theme Contract

The default theme should make runtime decisions from canonical context only:

- use `system.data_domain` for domain branching
- use `system.route_kind` for route-level branches
- use `system.category_base` / `system.tag_base` for permalink-aware links

Avoid special-case logic in CMS renderers for theme behavior. Theme behavior belongs in theme templates/assets.

## Theme Sandbox Contract

The authoritative contract for CMS/theme separation lives in:

- `docs/THEME_SANDBOX_CONTRACT.md`
- `docs/EXTENSION_CONTRACTS.md`

## Enabled/disabled semantics

- Themes are globally enabled/disabled.
- Site selector only permits enabled themes.
- Site theme key:
  - `site_<siteId>_theme`

## Token resolution order

1. Internal fallback tokens
2. Selected theme tokens
3. Optional `theme:tokens` filter overrides

This keeps pages renderable even if theme files are incomplete.

## Tailwind strategy

Themes provide token class strings, not standalone CSS pipelines.
This avoids runtime Tailwind config mutation and keeps deploys stable on Vercel.

## Recommended theme authoring

Theme templates receive a `tooty` context object (internal JS-backed data, no REST) with:
- `tooty.site`
- `tooty.settings.siteUrl`
- `tooty.settings.seoMetaTitle`
- `tooty.settings.seoMetaDescription`
- `tooty.domains`
- `tooty.pluginSettings`
- `tooty.query` (Core-resolved, read-only query results)

### Theme Query Contract

Themes may consume Core query results from `tooty.query.<key>`.
Queries are not raw SQL and are never theme-executed directly.

Current generic query source:
- `content.list`

Example request shape (declared in `theme.json` under `queries`):
- `key`: result key for template access
- `source`: `"content.list"`
- `scope`: `"site"` or `"network"`
- `route`: optional route selector (`home`, `domain_archive`, `domain_detail`, etc.)
- `params`: whitelisted query params (`dataDomain`, `taxonomy`, `withTerm`, `limit`, `metaKeys`)

Governance:
- Queries are read-only.
- Params are normalized and bounded.
- `scope="network"` is enabled only through global settings and only for main site or permissioned site IDs.
- Network results are restricted to the same owner network.

1. Start from existing manifest and change tokens incrementally.
2. Keep token names consistent.
3. Keep contrast accessible for text/navigation.
4. Avoid relying on runtime-only classes that may be purged.

## Template Fallback Hierarchy

Theme authors should rely on the core fallback contract when naming templates.

### Core resolution order

- Home: `home.html` -> `index.html`
- Domain detail: `single-<plural-domain>-<slug>.html` -> `single-<domain>-<slug>.html` -> `single-<plural-domain>.html` -> `single-<domain>.html` -> `<plural-domain>-<slug>.html` -> `<domain>-<slug>.html` -> `single.html` -> `index.html`
- Domain archive: `archive-<plural-domain>.html` -> `archive-<domain>.html` -> `archive.html` -> `<plural-domain>.html` -> `<domain>.html` -> `index.html`
- Taxonomy: `taxonomy-<taxonomy>-<term>.html` -> `taxonomy-<taxonomy>.html` -> `taxonomy.html` -> `archive.html` -> `index.html`

Guidance:
- Prefer route-specific files (`archive-posts.html`, `single-post.html`, `archive-pages.html`, `single-page.html`) for precise control.
- Provide `single.html` and `archive.html` as broad fallbacks for all content domains.
- Keep data-domain identity singular while route/archive naming is plural (for example `post` -> `posts`, `page` -> `pages`).
