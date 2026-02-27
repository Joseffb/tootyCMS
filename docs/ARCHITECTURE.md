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
- Site menus: `site_<siteId>_menu_<location>`

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
