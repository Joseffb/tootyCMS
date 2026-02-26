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
- Example: type `post` maps to table/key identity; UI shows `Posts`.

### API Route Naming

- Listing/collection endpoints must use plural nouns.
- Detail/single-resource endpoints must use singular nouns.
- Example: `posts` = listing, `post/:id` = detail.
- This convention applies to internal APIs and extension-facing routes.

## Permalink Contract (MUST)

Default SEO permalink system for new installs:

- Canonical detail URL: `/%domain%/%postname%/`
- Canonical archive URL: `/%domain_plural%/`
- `post` is a normal domain key (detail: `/post/<slug>`, archive: `/posts`)

Strict defaults:

- No flat slug permalinks (`/%postname%/`) by default.
- No taxonomy shortcut permalinks (`/c/<slug>`, `/t/<slug>`, `/<taxonomy>/<slug>`) by default.
- Non-canonical routes return `404` unless a site-level override enables alternate patterns.

Per-site overrides:

- A site may define custom permalink tokens in settings (WordPress-style), but the default contract above must remain the system default.
- When overrides are enabled, canonical URL output, sitemap generation, and route resolution must use the active site pattern.

## Plugin Contract

Typed contract: `PluginContract` (`lib/extension-contracts.ts`)

Plugins may:

- Register hooks and admin extensions through Core kernel APIs
- Register content-type and server behavior only through Core contract surfaces
- Read/write scoped settings through the Plugin Extension API
- Register content types and server handlers through Plugin Extension API methods exposed by Core
- Use declared capability flags for guarded surfaces (`hooks`, `adminExtensions`, `contentTypes`, `serverHandlers`, `authExtensions`, `scheduleJobs`, `communicationProviders`, `webCallbacks`)
- Extend admin profile UI through filter hooks (for example `admin:profile:sections`)
- Declare plugin scope explicitly:
  - `scope: "network"` = network-governed plugin. Network enablement is global and treated as network-required for sites.
  - `scope: "site"` = site plugin. It must be globally enabled; by default it is enabled/disabled per site, and may be forced network-wide with global `networkRequired`.
  - `distribution: "core" | "community"` is metadata (origin tag), not activation scope.

Scope governance:

- Network plugins are for network-wide behavior and platform operations.
- Site plugins are for tenant/site-owned behavior, integrations, and content features.
- Analytics providers and consent/GDPR behavior are typically `scope: "site"` plugins unless a network policy explicitly requires forced rollout.

### Auth Provider Plugin Contract (MUST)

- Native auth is core baseline and always available.
- OAuth providers are plugin-backed and must declare:
  - `capabilities.authExtensions: true`
  - `authProviderId` (for example: `github`, `google`, `facebook`, `apple`)
- Global plugin enabled state controls provider availability at login.
- Multiple auth provider plugins may be enabled at the same time.
- Core user records are global and are not site-bound in current contract.

### Analytics Contract (MUST)

Core owns analytics event semantics and dispatch:

- Canonical event names (example: `page_view`, `content_published`, `content_deleted`, `custom_event`)
- Canonical payload envelope and timing
- Consent gate before dispatch
- Canonical envelope versioning (`version: 1` current)

Analytics plugins are transport adapters only:

- Subscribe to `domain:event` to forward events to a provider.
- Optionally expose query adapters via `domain:query`.
- Optionally expose script adapters via `domain:scripts`.
- Must not redefine core event names or schema semantics.

Canonical analytics envelope (`domain:event` payload):

- `version: 1` (required)
- `name: "page_view" | "content_published" | "content_deleted" | "custom_event"` (required)
- `timestamp: ISO-8601` (required)
- `payload: Record<string, unknown>` (required)
- `siteId?: string`
- `domain?: string`
- `path?: string`
- `actorType?: "anonymous" | "user" | "admin" | "system"`
- `actorId?: string`
- `meta?: Record<string, unknown>` (reserved extensibility bag)

Analytics query contract (`domain:query`):

- Input context includes `name` and `params`.
- Plugin returns an HTTP `Response`/`NextResponse` or `null` (no-op).
- Core keeps provider-neutral fallback when no plugin handles a query.

Analytics scripts contract (`domain:scripts`):

- Plugin returns script descriptors only (transport layer), not event semantics.
- Descriptor shape:
  - `id: string` (required)
  - `src?: string`
  - `inline?: string`
  - `strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive"`
  - `attrs?: Record<string, string>`

### Communication Contract (MUST)

Core owns communication semantics and dispatch:

- canonical message schema (`channel`, recipients, content, metadata)
- queue + attempt audit records
- retry/failure policy ownership
- consent/policy checks before provider delivery

Communication provider plugins are transport adapters only:

- register channel handlers through core communication registration
- map canonical payload to provider API payload
- return normalized provider response/error data
- do not define canonical communication business semantics

Canonical channels:

- `email`
- `sms`
- `mms`
- `com-x`

Provider registration contract:

- plugin declares `capabilities.communicationProviders: true`
- provider registration includes:
  - `id`
  - `channels: string[]`
  - `deliver(message) => { ok: boolean; externalId?: string; response?: Record<string, unknown>; error?: string }`

If no provider is available for a channel, core uses null-provider behavior (audit/log only, no external send).

### Webcallback Contract (MUST)

Core owns callback ingestion and audit:

- callback ingress routes
- request audit rows
- handler dispatch and failure recording

Plugin handlers are adapter surfaces only:

- declare `capabilities.webCallbacks: true`
- register `id` + `handle({ body, headers, query })`
- return normalized processing result

Callback handlers must not bypass core auth/routing/schema protections.

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
- Theme query requests are declared by themes in `theme.json` (`queries`) and resolved by route in Core. Core routes must not hardcode theme-specific query keys.

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

## Theme Template Fallback Contract (MUST)

Core resolves template files in deterministic order. Themes should implement the highest-priority files they need.

### Home Route

1. `home.html`
2. `index.html`

### Data-Domain Detail Route (`/<domain>/<slug>`)

Where `<domain>` is canonical singular key and plural aliases are supported. `post` is treated as a normal domain key.

1. `single-<plural-domain>-<slug>.html`
2. `single-<domain>-<slug>.html`
3. `single-<plural-domain>.html`
4. `single-<domain>.html`
5. `<plural-domain>-<slug>.html`
6. `<domain>-<slug>.html`
7. `single.html`
8. `index.html`

### Data-Domain Archive Route (`/<plural-domain>`)

1. `archive-<plural-domain>.html`
2. `archive-<domain>.html`
3. `archive.html`
4. `<plural-domain>.html`
5. `<domain>.html`
6. `index.html`

### Taxonomy Route (`/c/<term>`, `/t/<term>`, domain taxonomies)

1. `taxonomy-<taxonomy>-<term>.html`
2. `taxonomy-<taxonomy>.html`
3. `taxonomy.html`
4. `archive.html`
5. `index.html`

### 404 Route

1. `404.html`
2. `index.html`

Rules:
- Core must not fall back to unrelated route templates (e.g. domain archives must not force `posts.html`).
- Data-domain identity remains singular in data contracts; listing routes remain plural.

## Theme Link Alias Contract (MUST)

Core provides stable `links.*` aliases in theme render context for legal/footer navigation:

- `links.about`
- `links.tos`
- `links.privacy`

Default slug mapping (authoritative defaults):

- `links.about` -> `page/about-this-site`
- `links.tos` -> `page/terms-of-service`
- `links.privacy` -> `page/privacy-policy`

Permalink behavior:

- Slugs above are fixed defaults unless changed in core code.
- URL shape is computed through active site permalink settings (default/custom, domain-prefix/no-prefix).
- These aliases generate URLs only; they do not search content or guarantee that target pages exist.
