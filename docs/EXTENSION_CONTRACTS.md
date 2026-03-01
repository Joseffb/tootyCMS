# Extension Contracts

Tooty supports both plugins and themes with explicit governance to avoid unmanaged entropy.

## Core Authority (MUST)

Core is the only authority for:

- Routing, auth, and security
- Database writes and schema changes
- Render pipeline and extension loading
- Side effects (must flow through Core APIs)

Core must remain platform-generic:

- Core must not be changed to satisfy one specific plugin or one specific theme.
- Plugins and themes must adapt to published core contracts and extension points.
- If a request pressures core toward a one-off extension-specific behavior, the default answer is to reject it or solve it through existing generic contracts.

## Governance Exception: Spine Service Plugins (RARE, MUST)

There is one narrow exception to the no-one-off-core-change rule:

- A governance-sensitive capability may be implemented as a spine service in plugin form when compliance, audit, or operational policy requires that the entire capability can be disabled or removed in one action.
- The purpose of this pattern is kill-switch control across a whole activity class, not convenience customization for one extension.
- Pre-v1, the only approved spine service plugin is `export-import`.
- `export-import` is the single sanctioned exception because import/export is a compliance-sensitive, audit-sensitive capability where operators may need one kill switch that removes the entire migration surface in one action.

Examples:

- export/import
- data extraction/export surfaces
- other tightly governed system capabilities that may need platform-wide disablement

Mandatory constraints:

- Spine service plugins must be rare.
- They must be designed so disabling the plugin cleanly kills that class of activity.
- They are platform service boundaries, not ordinary third-party extension surfaces.
- Third-party or normal plugin developers must not define new spine service plugin categories.
- Third-party or normal plugin developers must not claim the `export-import` exception for ordinary feature routes, business logic, UI, or transport.
- Only the Tooty core team may approve and implement a new spine service plugin pattern.

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

Core's responsibility for plugins is limited to the plugin spine:

- registry and discovery
- lifecycle and hook dispatch
- capability bridge
- loading/activation mechanism

Hard boundary:

- Core must not contain plugin business logic.
- Core must not contain plugin feature-specific UI.
- Core must not contain plugin-owned routes.
- Core must not contain plugin feature code or feature semantics.
- The only pre-v1 exception is the governed `export-import` spine service. Its transport may remain kernel-owned because it is treated as a platform service packaged in plugin form, not as a normal feature plugin.
- Feature behavior, business rules, admin UI, and route handlers belong in the plugin itself unless the user explicitly approves a platform-level architectural change.

Plugins may:

- Register hooks and admin extensions through Core kernel APIs
- Register content-type and server behavior only through Core contract surfaces
- Read/write scoped settings through the Plugin Extension API
- Register content types and server handlers through Plugin Extension API methods exposed by Core
- Use declared capability flags for guarded surfaces (`hooks`, `adminExtensions`, `contentTypes`, `serverHandlers`, `authExtensions`, `scheduleJobs`, `communicationProviders`, `commentProviders`, `webCallbacks`)
- Extend admin profile UI through filter hooks (for example `admin:profile:sections`)
- Declare plugin scope explicitly:
  - `scope: "network"` = network-governed plugin. Network enablement is global and treated as network-required for sites.
  - `scope: "site"` = site plugin. It must be globally enabled; by default it is enabled/disabled per site, and may be forced network-wide with global `networkRequired`.
  - `distribution: "core" | "community"` is metadata (origin tag), not activation scope.
- Declare plugin/theme `tags: string[]` for multi-label classification (for example `utility`, `auth`, `teety`, `theme`).
- Declare plugin admin menu placement explicitly when exposing dashboard pages:
  - `menuPlacement: "settings" | "root" | "both"`
  - default is `"settings"`
  - `settingsMenu` may provide a dedicated settings route/label when the primary `menu` is a root workspace
- Declare a generic structured content model for richer plugin-managed workspaces:
  - `contentModel.kind: "collection"` is the current supported model
  - it describes a parent content type plus a child content type linked through metadata
  - core persists this as generic plugin content-type registration metadata; core does not special-case the plugin id
  - themes consume the resulting content through normal theme queries, not direct plugin rendering

### Plugin Admin UX + Accessibility (MUST)

Plugin and theme contributions that expose admin or interactive UI are expected to satisfy the baseline rules in [`docs/PLUGIN_ADMIN_UX.md`](./PLUGIN_ADMIN_UX.md).

This is an acceptance rule, not optional polish.

Minimum baseline:

- keyboard-reachable interaction
- explicit labels for interactive controls
- visible mutation feedback
- no color-only state meaning
- explicit button semantics
- image alternatives where images are not purely decorative

Where an enforceable baseline audit exists in core or extension repositories:

- CI should fail on violations
- maintainers should require revision before acceptance

### Collection Content Model Contract (MUST)

Use this when a plugin manages reusable parent/child content collections (for example sets + items).

Required fields:

- `parentTypeKey`
- `childTypeKey`
- `childParentMetaKey`
- `parentHandleMetaKey`
- `workflowMetaKey`
- `orderMetaKey`

Optional fields:

- `childParentKeyMetaKey`
- `mediaMetaKey`
- `ctaTextMetaKey`
- `ctaUrlMetaKey`
- `workflowStates`

Contract rules:

- Parent and child content types must still be registered through normal plugin content-type registration.
- Relationships are metadata-driven; plugins do not get direct schema bypasses.
- Workflow states are declarative and must map onto core-owned lifecycle handling.
- Media linkage is metadata-backed and must resolve through core-managed media records.
- Theme rendering remains query-first. Plugin content models do not grant plugins direct control over frontend rendering.

Scope governance:

- Network plugins are for network-wide behavior and platform operations.
- Site plugins are for tenant/site-owned behavior, integrations, and content features.
- Analytics providers are typically `scope: "site"` plugins unless a network policy explicitly requires forced rollout.
- Consent/GDPR UX may be packaged as a site plugin, but consent enforcement remains core-owned pre-v1 unless a future plugin contract replaces it.

### Auth Provider Ownership (PRE-V1, MUST)

- Native auth is core baseline and always available.
- Auth transport remains core-owned through the NextAuth transport layer (`/api/auth/*`).
- External auth providers are plugin-delivered capability extensions registered through the kernel auth provider registry.
- `capabilities.authExtensions` is the required capability for `api.registerAuthProvider(...)`.
- Auth plugins extend provider capability only; they do not mount raw routes, mutate cookies, or own session lifecycle.
- Global plugin enabled state controls provider availability at login.
- Multiple first-party provider integrations may be enabled at the same time.
- Core user records are global and are not site-bound in current contract.

Hard auth invariants:

- plugins must not mount or override `/api/auth/*`
- session/token creation remains core-owned
- identity persistence remains core-owned
- auth extensibility means provider extensibility, not transport extensibility
- first-party auth plugins are runtime provider engines through the governed auth provider registry

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
- Require one-off core changes for plugin-specific behavior outside published contracts

Plugin admin menu placement contract:

- `"settings"`: plugin admin page is surfaced under `Settings > Plugins`
- `"root"`: plugin admin page is surfaced as a root dashboard nav item
- `"both"`: plugin gets a root workspace nav item and a settings nav item
- `settingsMenu` is optional and is intended for plugin-specific configuration routes
- When `menuPlacement` is `"root"` and `settingsMenu` is omitted, the plugin is still configurable from the core plugin settings screen, but it does not get a nested settings nav link

## Spine Provider Pattern (MUST)

All spine systems follow one model:

- plugin-provider registration contract for extension providers
- optional core-owned adapter helpers for provider registration, when the capability spine needs a reusable baseline storage or transport adapter

Implications:

- provider behavior is active only when a plugin registers it through the declared contract
- core may expose generic adapter helpers, but core must not silently synthesize or auto-enable a provider when no plugin registered one
- plugin providers extend or replace delivery/query behavior through declared contracts
- new spine systems (for example search, comments, messaging, analytics adapters) must adopt this same pattern

Governance note:

- When a spine system is also governance-sensitive, the preferred implementation is a core-team-controlled spine service plugin so the capability can be disabled in one action.
- This does not permit normal plugin developers to create new privileged spine categories.

Comment provider adapter note:

- For site-scoped comment providers, Core may expose a generic adapter helper through the extension API (`api.core.comments.createTableBackedProvider()`).
- This is a reusable storage adapter, not an active provider by itself.
- The plugin must still call `registerCommentProvider()` to make the provider live.

### Comment Provider Writing Options UI Contract (MUST)

When a comment provider exposes `writingOptions`, Core renders them in site writing settings using provider metadata:

- Section title uses the active provider name/id (for example: `Tooty Comments Options`).
- Options are rendered as a dependency tree using `dependsOn` links.
- Child options are nested under the parent option they depend on.
- Visibility is controlled by dependency state (`dependsOn.key` and `dependsOn.value`), not hardcoded Core key checks.

`CommentProviderWritingOption` supports:

- `dependsOn?: { key: string; value: boolean }`

Provider authors should define dependencies in option metadata so Core can render provider-specific settings behavior without custom UI logic.

## Theme Contract

Typed contract: `ThemeContract` (`lib/extension-contracts.ts`)

Themes may:

- Provide layouts, components, styles, and assets
- Use lightweight template conditionals for presentation decisions
- Consume DTO/query data already prepared by Core or plugins and render UI

Theme template precedence for plugin-owned content types:

1. Active theme, specific template (for example `single-carousel.html`)
2. Plugin-provided fallback template for that plugin-owned type (for example `plugins/tooty-carousels/templates/single-carousel.html`)
3. Core fallback

Notes:

- Generic theme templates like `single.html` are not intended to outrank a plugin's specific fallback for plugin-owned content types.
- Plugin fallback templates apply only to plugin-owned content types or plugin-owned routes, not core-owned types like `post` or `page`.
- Themes still retain first override priority whenever they provide a specific matching template.

Themes may not:

- Contain business logic
- Perform direct data access outside Core-provided theme query/DTO surfaces
- Own or alter routing
- Evaluate capabilities, permissions, or governance decisions
- Execute server-side side effects
- Perform DB writes
- Alter auth, routing, or schema
- Depend on feature-specific control booleans injected by Core for one plugin

Governance boundary:

- Themes are presentation modules only.
- All feature behavior belongs in plugins.
- Core contains only spines and contracts for extension behavior.
- Themes should consume generic slots, DTOs, and query results rather than plugin-specific permission flags.

Generic theme slot contract:

- Plugins may contribute renderable theme slots through the `theme:slots` filter.
- Slots are keyed strings exposed to templates as `tooty.slots.<key>`.
- Core may pass route-scoped context into the slot filter, but core must remain generic and must not synthesize feature-specific slot markup on behalf of a plugin.
- Themes may render a slot if present, but must not re-implement plugin behavior around that slot.

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
