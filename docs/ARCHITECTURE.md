# Tooty CMS Extensibility Architecture

Tooty CMS uses one extensibility spine so themes, menus, and plugins can evolve without tightly coupling features.

## Related docs

- `docs/KERNEL.md`
- `docs/LIFECYCLE_HOOKS.md`
- `docs/MENUS.md`
- `docs/PLUGINS.md`
- `docs/THEMES.md`
- `docs/THEME_SANDBOX_CONTRACT.md`
- `docs/EXTENSION_CONTRACTS.md`
- `docs/TRACING.md`
- `docs/MEDIA_MANAGER.md`
- `docs/DATA_DOMAINS.md`

## Goals

1. Keep the CMS easy for indie developers today.
2. Preserve a stable kernel contract for future SaaS/platform use.
3. Support drop-in filesystem modules for local/dev workflows.
4. Store all enable/disable/config state in DB so behavior is deterministic.

## System boundaries

- Kernel: event/filter/menu registry and execution order.
- Theme system: visual token manifests plus per-theme optional settings.
- Plugin system: capability manifests, optional runtime registration, admin menu links.
- Menu system: site-level navigations per location with JSON persistence.
- Data domains: post-type registry + per-site activation + domain content model.
- Media manager: shared object storage + DB indexed site-scoped media library.

None of these systems directly require each other internally. They integrate through kernel contracts and shared settings storage.

Theme/CMS separation contract: `docs/THEME_SANDBOX_CONTRACT.md`.

## Runtime request flow

1. Request is normalized by middleware/proxy rules to resolve domain context.
2. Site and domain records are loaded.
3. `createKernelForRequest()` creates kernel and registers enabled plugins.
4. Lifecycle actions execute in order:
   - `request:begin`
   - `render:before`
   - `render:after`
   - `request:end`
5. Theme tokens are resolved from:
   - global fallback
   - selected site theme
   - optional filters (`theme:tokens`)
6. Menu for the active location is loaded from DB and filtered via `nav:items`.
7. Rendered layout and components consume resolved tokens and menu data.

## Theme render flow (canonical)

1. Active theme/template is resolved via `lib/theme-runtime.ts`.
2. Route payload is prepared (site, hero/posts/content, links, etc).
3. `renderThemeTemplate()` normalizes canonical system context via `lib/theme-system-context.ts`.
4. Normalized `system` plus top-level aliases are exposed globally to Nunjucks.
5. Template decisions are made from these primaries, not ad-hoc route-specific flags.

Canonical primaries include:
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

## Content request flow

1. Content route loads post/site entities.
2. Kernel action `content:load` fires with route context.
3. Optional filters run:
   - `content:transform`
   - `page:meta`
   - `render:layout`
4. Final page is rendered.

## Editor autoloaders and article state

Editor autoloaders on article/item pages must track explicit article-owned load state.

- `loaded and empty` is a valid terminal state and must not be treated as `not loaded yet`
- background loaders must consult article/editor state before re-fetching article-owned resources such as taxonomy reference data
- autoloader helpers must update and consult article-owned settled state before issuing any background fetch
- editor autoloaders must not use empty arrays alone as a refresh trigger
- article editor state must converge to one authoritative loaded state before additional eager refreshes are scheduled
- eager autoload retry budgets must be driven by article-owned evidence such as selected terms, pending writes, or known nonzero term counts; they must not blindly retry empty reference loads
- article autoloaders must carry an explicit settled state so a previously-attempted empty load cannot silently regress into a new background fetch loop
- persisted article/item pages that already received seeded editorial taxonomy reference data must not background-fetch `category` or `tag` again just to expand or confirm the same state
- client-side category/tag reference helpers on persisted article/item pages must fail closed to local/cache-only state rather than issuing follow-up network requests
- the `/api/editor/reference?taxonomy=category|tag` compatibility path is forbidden for persisted article/item editors; eager editorial taxonomies must be seeded by the item route itself and direct eager reads must fail closed

## Dashboard flow

1. Themes and plugins are discovered from filesystem folders.
2. Dashboards list manifests with current state (enabled/config).
3. Changes write through the settings spine (`lib/settings-store.ts`) to provider tables.
4. Plugin menu descriptors are surfaced in dashboard nav through `/api/plugins/menu`.

## Persistence model

All extensibility state persists via settings providers:
- global keys in `tooty_system_settings`
- site-scoped keys in per-site physical tables `tooty_site_<n>_settings` (allocated by registry)

- Plugin enable state: `plugin_<id>_enabled`
- Plugin config: `plugin_<id>_config`
- Theme enable state: `theme_<id>_enabled`
- Theme config: `theme_<id>_config`
- Site selected theme: `site_<siteId>_theme`
- Site menus: `<prefix>site_{siteId}_menus`, `<prefix>site_{siteId}_menu_items`, `<prefix>site_{siteId}_menu_item_meta`

## Filesystem conventions

- Themes root: `themes/<theme-id>/theme.json`
- Plugins root: `plugins/<plugin-id>/plugin.json`
- Optional plugin runtime: `plugins/<plugin-id>/index.mjs`

The folder name is a fallback identifier when manifest id is missing. IDs are normalized and sanitized.

## Why this architecture scales

1. Kernel contracts are stable and explicit.
2. Extension state is DB-backed and auditable.
3. Theme/plugin discovery is simple for local development.
4. Hook-based integration avoids hardcoding feature dependencies.
5. Existing sites can selectively adopt new extensions without data migration churn.
