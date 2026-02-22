# Extension Contracts

Tooty supports both plugins and themes with explicit governance to avoid unmanaged entropy.

## Core Authority (MUST)

Core is the only authority for:

- Routing, auth, and security
- Database writes and schema changes
- Render pipeline and extension loading
- Side effects (must flow through Core APIs)

## Naming Contracts (MUST)

### Data Domain Naming

- Canonical data-domain type names are singular (for key and DB table identity).
- Admin/UI menu labels are pluralized for collection/listing navigation.
- Example: type `project` maps to table/key identity; UI shows `Projects`.

### API Route Naming

- Listing/collection endpoints must use plural nouns.
- Detail/single-resource endpoints must use singular nouns.
- Example: `posts` = listing, `post/:id` = detail.
- This convention applies to internal APIs and extension-facing routes.

## Plugin Contract

Typed contract: `PluginContract` (`lib/extension-contracts.ts`)

Plugins may:

- Register hooks and admin extensions through Core kernel APIs
- Register content-type and server behavior only through Core contract surfaces
- Read/write scoped settings through the Plugin Extension API
- Register content types and server handlers through Plugin Extension API methods exposed by Core
- Use declared capability flags for guarded surfaces (`hooks`, `adminExtensions`, `contentTypes`, `serverHandlers`, `authExtensions`)

Plugins may not:

- Bypass auth checks
- Write raw DB tables directly as an extension contract
- Mutate routing/auth/schema outside Core

## Theme Contract

Typed contract: `ThemeContract` (`lib/extension-contracts.ts`)

Themes may:

- Provide layouts, components, styles, and assets
- Use lightweight template conditionals for presentation decisions

Themes may not:

- Execute server-side side effects
- Perform DB writes
- Alter auth, routing, or schema

Runtime guardrails:

- `createThemeExtensionApi()` throws when side-effect methods are called (`setSetting`, `setPluginSetting`).
- Plugin runtime enforces declared capability flags and throws `[plugin-guard]` on unauthorized operations.
- Theme query surfaces are read-only and whitelisted by Core (`lib/theme-query.ts`), with validated params and strict limits.
- `scope="network"` queries are governance-gated: only main site or permissioned site IDs can aggregate network content, and only within the same owner network.

## Loader Validation

Manifest files are validated before activation:

- Plugins: `plugins/*/plugin.json` via `validatePluginContract()`
- Themes: `themes/*/theme.json` via `validateThemeContract()`

Invalid manifests are ignored at discovery time.

## Directory Contract

- Themes: `themes/<theme-id>/...`
- Plugins: `plugins/<plugin-id>/...`

Core discovers extensions from these roots by default.

Optional runtime overrides:
- `THEMES_PATH`
- `PLUGINS_PATH`

When set, paths may be absolute or workspace-relative.
