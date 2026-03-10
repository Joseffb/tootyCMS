# Extension Contracts

Tooty supports both plugins and themes with explicit governance to avoid unmanaged entropy.

## Core Authority (MUST)

Core is the only authority for:

- Routing, auth, and security
- Database writes and schema changes
- Render pipeline and extension loading
- Side effects (must flow through Core APIs)
- Infrastructure spine services (for example media)
- Database compatibility/version tracking

Core must remain platform-generic:

- Core must not be changed to satisfy one specific plugin or one specific theme.
- Plugins and themes must adapt to published core contracts and extension points.
- If a request pressures core toward a one-off extension-specific behavior, the default answer is to reject it or solve it through existing generic contracts.
- Core may own governed Spine Services and platform-wide default providers when those providers remain replaceable through stable extension contracts.

## Tenant Storage Boundary Contract (MUST)

Network and site storage are strict, separate persistence layers.

### 1) Network-level tables (global scope)

Network tables must be explicit and minimal. Naming is:

- `<prefix>network_<entity>`

Network/global tables are only for platform governance/orchestration and must not store site feature content.

Examples include:

- auth/session/account tables
- network site lookup (`<prefix>network_sites`)
- global system settings
- RBAC role definitions
- network-managed webhook/communication orchestration

### 2) Site-level feature storage (site scope)

All site feature data must live in physical site tables named with concrete site identity:

- `<prefix>site_{id}_<entity>`

Examples:

- `<prefix>site_{id}_domain_posts`
- `<prefix>site_{id}_domain_post_meta`
- `<prefix>site_{id}_domain_events_queue`
- `<prefix>site_{id}_terms`
- `<prefix>site_{id}_term_taxonomies`
- `<prefix>site_{id}_media`
- `<prefix>site_{id}_menus`

### 3) Prohibited pattern for site feature storage

Do not store tenant feature rows in shared multi-tenant feature tables that depend on a row-level `siteId` discriminator.

Prohibited for feature storage:

- shared `site_*` feature tables like `<prefix>site_domain_posts`, `<prefix>site_media`, `<prefix>site_terms` (table names without concrete `<siteId>` in the table name)
- shared/global event queues like `<prefix>domain_events_queue`; domain event queues must be site-physical

### 4) Column rule

Site-physical feature tables must not include a `siteId` column.

- tenant isolation is encoded in table identity
- cross-site joins for feature storage are not allowed through row-level site discriminators

### 5) New feature rule

Any new feature that persists tenant data must:

- declare storage scope (network vs site-physical)
- use site-physical table naming for tenant feature data
- include automated tests that fail when:
  - site feature data is written to shared global feature tables
  - a site-physical feature table includes a `siteId` column
  - a non-allowlisted network table stores site feature content

### 6) Registry policy (pre-v1 hard mode)

Deterministic site table naming is derived from `network_sites.id`.

- Do not introduce registry tables for site feature table discovery.
- Remove obsolete site/user/settings registry tables.
- Table name derivation must be deterministic from `<prefix> + site id + entity`.

## Governance Exception: Spine Service Plugins (RARE, MUST)

There is one narrow exception to the no-one-off-core-change rule:

A spine service is a kernel-owned infrastructural subsystem that defines canonical transport, persistence authority, and extension contracts.

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

## Admin Scope Contract (MUST)

Admin navigation and settings scope are core-owned runtime contracts.

Core must publish a server-derived admin scope model that includes:

- `adminMode`: `single-site` or `multi-site`
- `activeScope`: `network`, `site`, or `merged-single-site`
- `mainSiteId`
- `effectiveSiteId`

Rules:

- Clients must not infer admin mode by recomputing `siteCount === 1`.
- Single-site mode is user-relative and merges network/site settings into one canonical site-scoped settings model.
- Canonical single-site settings routes are `/app/site/{mainSiteId}/settings/*`.
- Compatibility network settings routes may exist, but the primary nav model in single-site mode must remain the merged site-scoped model.
- Multi-site network nav must not inject site settings.
- Multi-site site nav must not inject network settings.

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

## Extension Trust And Signature Policy (MUST)

Extension installation is a security, trust, and supportability boundary.

Core must classify installable plugin or theme packages into exactly three trust tiers:

### 1) `tooty_verified`

This tier applies when:

- the package signature is valid
- the signer is in the Tooty trusted signer set shipped or updated through Core trust metadata

This tier may include:

- first-party Tooty extensions
- third-party extensions that have passed a Tooty marketplace review/signing process

Required behavior:

- install may proceed without an interruptive warning flow
- UI may show a quiet verification signal such as `Verified by Tooty`
- this is the only tier allowed to feel seamless by default

### 2) `signed_unverified`

This tier applies when:

- the package signature is cryptographically valid
- the signer is not in the Tooty trusted signer set

Required behavior:

- install must not be silent
- UI must present a blocking high-friction warning before installation continues
- warning copy must frame the risk in terms of security, compatibility, and supportability
- warning UI must clearly state that the publisher is not verified by Tooty
- operator confirmation must be explicit; a passive notice or non-blocking toast is insufficient

### 3) `unsigned_or_invalid`

This tier applies when:

- the package has no signature
- the signature is invalid
- the signer identity cannot be resolved

Required behavior:

- install must be rejected
- normal runtime/admin flows must not provide a silent or convenience bypass

### Public Product Framing

Public/admin messaging for extension trust must be framed as:

- security
- integrity
- compatibility
- supportability

Core must not describe the trust policy as brand protection, marketplace suppression, or anti-competitive preference.

### Marketplace / Registry Compatibility

Future marketplace or registry support is allowed, but it must preserve the local trust model.

Rules:

- local signature verification remains mandatory even when a package is downloaded from a Tooty marketplace or registry
- download source alone must not determine the trust tier
- a marketplace-listed third-party package may be classified as `tooty_verified` only when it is signed by a Tooty-trusted signer after the Tooty review/approval path
- a validly signed package from an untrusted signer remains `signed_unverified` whether it is installed from a file upload, direct URL, or future marketplace/registry source

### Dev/Local Exception

If a pre-v1 local development bypass exists, it must be explicitly scoped to dev/test environments and must not weaken the default production trust model.

## Plugin Contract

Typed contract: `PluginContract` (`lib/extension-contracts.ts`)

Core's responsibility for plugins is limited to the plugin spine:

- registry and discovery
- lifecycle and hook dispatch
- capability bridge
- loading/activation mechanism

## Content Meta Contract (MUST)

Core owns canonical content meta persistence.

### Themes

Themes are read-only consumers of content meta.

Allowed surface:
- `core.content.meta.read(...)`

Themes must not:
- write content meta
- delete content meta
- mutate scheduler or publish state through meta writes

### Plugins

Plugins may use governed content meta CRUD only for plugin-owned content.

Allowed surfaces:
- `core.content.meta.read(...)`
- `core.content.meta.set(...)`
- `core.content.meta.delete(...)`

Mandatory rules:
- plugin content meta CRUD must not apply to core-owned `post` or `page` content
- the plugin must declare `permissions.contentMeta.requested = true`
- the acting user must hold:
  - `manage_plugin_content_meta`, or
  - `manage_plugin_{pluginId}_content_meta`
- plugin-scoped mutation must be restricted to content types owned by that same plugin

Core-reserved hidden content meta keys may exist for core lifecycle features, including:
- `_view_count`
- `_publish_at`

Themes and plugins must not rely on hidden core lifecycle keys unless the relevant Core API contract explicitly exposes them.

## Plugin Permission Declaration + Install Consent (MUST)

Core owns roles. Plugins may declare requested capabilities and suggested default role grants, but they do not create roles.

Manifest contract:
- plugins may declare `permissions.contentMeta.requested = true`
- plugins may declare `permissions.contentMeta.suggestedRoles`

Derived capability rules:
- requesting plugin content-meta access creates a plugin-scoped capability contract:
  - `manage_plugin_{pluginId}_content_meta`
- plugins must not declare or request capabilities for another plugin id

Install flow rules:
- if a plugin requests governed permissions, install must present a blocking warning/consent step
- consent UI must show:
  - requested capability keys
  - which existing roles would gain them through suggested grants
- admin must explicitly confirm before install continues
- suggested grants for non-existent roles may be ignored, but they must not silently create roles

Infrastructure note:

- Media is a core spine service, not a normal plugin feature surface.
- Media provider/storage selection may be abstracted behind Core contracts, but media transport, indexing, access enforcement, and cleanup remain Core-owned.
- See [Media Spine System](./MEDIA_SPINE.md).

Database compatibility note:

- Database compatibility/version tracking is a first-class platform concern.
- If the required schema contract changes, the tracked target version and compatibility checks must move with it.
- Compatibility status must reflect the real required schema surface, not a stale subset of legacy checks.

Hard boundary:

- Core must not contain plugin business logic.
- Core must not contain plugin feature-specific UI.
- Core must not contain plugin-owned routes.
- Core must not contain plugin feature code or feature semantics.
- Core must not contain plugin-specific files.
- If a file exists only to serve one specific plugin, it does not belong in Core.
- Core may contain only:
  - generic extension spines
  - generic reusable primitives
  - kernel-owned infrastructure services
  - platform-wide default implementations that remain provider-replaceable through a spine contract
- This is a governed Spine Services model, not a literal empty-orchestrator model. See [Spine Services](./SPINE_SERVICES.md).
- Before any new extension-facing feature work continues, existing plugin-specific files must be removed or generalized so they are truly platform-generic.
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

### Media Spine Contract (MUST)

Media is a governed core spine service.

Core owns:

- upload routes
- storage provider selection
- DB index writes
- media URL resolution
- access enforcement
- cleanup execution

Plugins may:

- consume media through canonical media references
- store media ids or media-linked metadata through normal contracts
- use core-managed media APIs and selectors

Plugins must not:

- write directly to storage providers
- write directly to `tooty_media`
- bypass `/api/media` or governed upload routes
- perform direct media capability checks in place of core authorization

Themes must remain presentation-only consumers of media DTOs and URLs.

Recommended media capability vocabulary:

- `media.upload`
- `media.list.all`
- `media.list.own`
- `media.attach`
- `media.update.any`
- `media.update.own`
- `media.delete.any`
- `media.delete.own`

Media operations must always be tenant-scoped by `siteId`.

See [Media Spine System](./MEDIA_SPINE.md).

Core also ships the default governed admin surface for media selection and management:

- `media.manager`

Consumers should open the canonical media manager surface and persist `mediaId`-first selections rather than embedding ad hoc picker logic.

Scope governance:

- Network plugins are for network-wide behavior and platform operations.
- Site plugins are for tenant/site-owned behavior, integrations, and content features.
- Analytics providers are typically `scope: "site"` plugins unless a network policy explicitly requires forced rollout.
- Consent/GDPR UX may be packaged as a site plugin, but consent enforcement remains core-owned pre-v1 unless a future plugin contract replaces it.

### Analytics Visibility Contract (MUST)

Analytics UI surfaces (network dashboards, site dashboards, nav links, and analytics chips) must only render when both conditions are true:

- An analytics plugin is enabled for the site (`enabled && siteEnabled`).
- The active analytics provider can return graph/query data for the site.

Hard rules:

- RBAC permission (`site.analytics.read`) alone is not enough to show analytics UI.
- Plugin enablement alone is not enough to show analytics UI.
- If provider graph/query capability is unavailable, analytics UI must be hidden.

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
- Create extension-owned physical content tables for Data Domains or Taxonomy models
- Introduce new global feature tables when a site-scoped spine table already exists

Network/global schema rule (MUST):

- Global tables must remain sparse and limited to network administration concerns.
- Feature content storage (data domains, taxonomy term ownership, plugin content records, menus, comments, media usage) must be site-scoped by contract.

Plugin admin menu placement contract:

- `"settings"`: plugin admin page is surfaced under `Settings > Plugins`
- `"root"`: plugin admin page is surfaced as a root dashboard nav item
- `"both"`: plugin gets a root workspace nav item and a settings nav item
- `settingsMenu` is optional and is intended for plugin-specific configuration routes
- When `menuPlacement` is `"root"` and `settingsMenu` is omitted, the plugin is still configurable from the core plugin settings screen, but it does not get a nested settings nav link

## Spine Provider Pattern (MUST)

See also:

- `docs/SPINE_SERVICES.md`

Definition:

- A Spine Service is a governed core subsystem that owns canonical semantics, normalization, routing, and dispatch for a capability class while allowing one or more replaceable providers to implement delivery or persistence through stable plugin contracts.
- Core may provide first-party default providers for a Spine Service.
- Spine compliance is determined by replaceability and the absence of bypass paths, not by requiring core to be an empty orchestrator.

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
- External providers (for example Disqus-style or API-backed providers) may register directly through `registerCommentProvider()` and are not required to use Tooty's native comment tables.
- `tooty-comments` is the first-party plugin that enables Tooty's native comments system by registering the built-in table-backed provider through this same contract.

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
