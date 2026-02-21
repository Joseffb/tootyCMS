# Theme Sandbox Contract

This contract keeps CMS core and theme behavior strictly separated.

## Core Principle

CMS core gathers and passes canonical data. Themes decide presentation and visual behavior.

## CMS Responsibilities (MUST)

- Resolve site/domain/post/taxonomy/menu data.
- Normalize and pass canonical runtime context (`system.*` primaries).
- Expose stable template variables and filter/action contracts.
- Remain brand-neutral for render behavior (no mascot/theme-specific branching in CMS routes).

## CMS Prohibitions (MUST NOT)

- Must not pick or inject mascot/theme artwork in CMS route components.
- Must not branch render behavior by theme brand or mascot rules.
- Must not add theme-specific UI decisions in non-theme app routes.

## Theme Responsibilities (MUST)

- Own mascot/art direction and all visual decisions.
- Use canonical primaries (`system.route_kind`, `system.data_domain`, etc.) for conditional presentation.
- Keep theme-specific behavior inside theme templates/assets/config.

## Canonical Inputs for Theme Decisions

Themes should use only canonical primaries and explicit payload data:

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

## Compliance Checks

- No mascot/theme-brand imports in CMS route files under `app/[domain]/**` unless the route is a theme renderer.
- Theme decisions are implemented in `themes/<theme-id>/**`.
- Tracing logs show normal request lifecycle (`request:begin` -> `render:*` -> `request:end`) after changes.
