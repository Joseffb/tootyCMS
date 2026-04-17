# Plugin System

Plugin system files:

- Discovery/state: `lib/plugins.ts`
- Runtime bootstrapping: `lib/plugin-runtime.ts`
- Plugin dashboard page: `app/app/(dashboard)/settings/plugins/page.tsx`
- Plugin setup route: `app/app/(dashboard)/plugins/[pluginId]/page.tsx`
- Plugin menu API: `app/api/plugins/menu/route.ts`
- Carousel product boundary: `docs/CAROUSELS_PRODUCT_BOUNDARY.md`

## Purpose

1. Support drop-in functional extensions.
2. Keep plugin state managed through settings records.
3. Expose optional plugin setup surfaces in dashboard.
4. Integrate behavior through kernel hooks, not hardcoded imports.
5. Keep ordinary plugins out of raw transport; HTTP is kernel-owned.

Pre-v1 governance note:

- `export-import` is the only sanctioned spine service plugin exception.
- It exists in plugin form because import/export is a compliance-sensitive and audit-sensitive capability that may need a single kill switch.
- Disabling `export-import` must remove the whole migration surface in one action.
- This exception does not apply to normal feature plugins.

AI plugin note:
- AI plugins are not a separate extension system
- they use the same standardized manifest, capability, menu, editor, and API contracts as every other plugin
- they may not define AI execution behavior, quota enforcement, or allow/deny outcomes
- core remains the sole authority for `ai.run`, provider dispatch, quotas, guards, and trace

## Drop-in structure

Each plugin is a folder in `plugins/` by default.
You can override the plugin root with `PLUGINS_PATH` (absolute or workspace-relative path).

Required:

- `plugins/<plugin-id>/plugin.json`

Optional:

- `plugins/<plugin-id>/index.mjs` (runtime hook registration)

## Manifest schema

```json
{
  "id": "dev-tools",
  "name": "Dev Tools",
  "description": "Trace and diagnostics helpers",
  "version": "0.1.0",
  "minCoreVersion": "0.1.x",
  "tags": ["utility", "developer"],
  "capabilities": {
    "hooks": true,
    "adminExtensions": true,
    "contentTypes": false,
    "serverHandlers": false,
    "scheduleJobs": false,
    "communicationProviders": false,
    "webCallbacks": false,
    "aiProviders": false
  },
  "menuPlacement": "settings",
  "menu": { "label": "Dev Tools", "path": "/app/plugins/dev-tools" },
  "settingsFields": [
    { "key": "traceEnabled", "label": "Enable tracing", "type": "checkbox" }
  ]
}
```

Structured-content plugins may also declare a generic collection content model:

```json
{
  "contentModel": {
    "kind": "collection",
    "parentTypeKey": "carousel",
    "childTypeKey": "carousel-slide",
    "childParentMetaKey": "carousel_id",
    "childParentKeyMetaKey": "carousel_key",
    "parentHandleMetaKey": "embed_key",
    "workflowMetaKey": "workflow_state",
    "orderMetaKey": "sort_order",
    "mediaMetaKey": "media_id",
    "workflowStates": ["draft", "published", "archived"]
  }
}
```

This is a generic plugin contract. Core stores the relationship metadata for the plugin-owned content types, and the plugin setup UI can consume that metadata to present a reusable parent/child workspace without hardcoding a plugin id.

Versioning notes:
- Core is currently in `0.x` (early-contract phase).
- Use `minCoreVersion` to declare the minimum compatible core line for a plugin.
- `x` wildcard is allowed in `minCoreVersion` (`0.1.x` means `>= 0.1.0`).

## State keys

- enable key: `plugin_<id>_enabled`
- config key: `plugin_<id>_config`
- theme-visible plugin keys must be explicitly allowlisted in `theme_public_plugin_setting_keys` (comma-separated exact setting keys).

## Runtime registration

If `index.mjs` exports `register(kernel, api)`, it is invoked during kernel bootstrap for enabled plugins.

`api` is an internal JS API (not REST) and provides:
- `getSiteById(siteId)`
- `getSetting(key, fallback?)`
- `setSetting(key, value)`
- `getPluginSetting(key, fallback?)`
- `setPluginSetting(key, value)`
- `listDataDomains(siteId?)`
- `createSchedule(input)`
- `listSchedules()`
- `updateSchedule(scheduleId, input)`
- `deleteSchedule(scheduleId)`
- `registerScheduleHandler({ id, run })` (requires `capabilities.scheduleJobs=true`)
- `registerCommunicationProvider({ id, channels, deliver })` (requires `capabilities.communicationProviders=true`)
- `registerWebcallbackHandler({ id, handle })` (requires `capabilities.webCallbacks=true`)
- `registerAiProvider({ id, actions, run, healthCheck? })` (requires `capabilities.aiProviders=true`)

Service-style core namespace (recommended):
- `api.core.settings.get(key, fallback?)`
- `api.core.settings.set(key, value)`
- `api.core.site.get(siteId)`
- `api.core.dataDomain.list(siteId?)`
- `api.core.menus.list(siteId)`
- `api.core.menus.get(siteId, menuKey)`
- `api.core.menus.byLocation(siteId, location)`
- `api.core.menus.create(siteId, input)`
- `api.core.menus.update(siteId, menuKey, input)`
- `api.core.menus.delete(siteId, menuKey)`
- `api.core.menus.items.list(siteId, menuKey)`
- `api.core.menus.items.get(siteId, menuKey, itemId)`
- `api.core.menus.items.create(siteId, menuKey, input)`
- `api.core.menus.items.update(siteId, menuKey, itemId, input)`
- `api.core.menus.items.delete(siteId, menuKey, itemId)`
- `api.core.taxonomy.list()`
- `api.core.taxonomy.edit(taxonomyKey, "name:New Label")`
- `api.core.taxonomy.terms.list(taxonomyKey)`
- `api.core.taxonomy.terms.meta.get(termTaxonomyId)`
- `api.core.taxonomy.terms.meta.set(termTaxonomyId, key, value)`
- `api.core.schedule.create|list|update|delete(...)`
- `api.core.messaging.send|retryPending|purge(...)`
- `api.core.webcallbacks.dispatch|listRecent|purge(...)`
- `api.core.webhooks.subscriptions.list|upsert|delete(...)`
- `api.core.webhooks.deliveries.retryPending(...)`
- `api.core.ai.run(...)`

AI governance rules:
- AI plugins declare influence; core computes outcome
- plugins must not inject query-based AI governance or hidden runtime branching
- provider registration is allowed; provider-side policy is not

Comment provider note:
- `registerCommentProvider(...)` is the authoritative extension path for comments providers.
- `api.core.comments.createTableBackedProvider()` is optional and only exists as a reusable adapter for Tooty's native table-backed comments.
- Third-party comment providers may register their own provider implementation and use external storage/services instead of Tooty's native comment tables.
- `tooty-comments` is the first-party plugin that enables the native table-backed provider.

Menu API note:

- Menu reads are available to plugins through the core menu service.
- Menu writes remain Core-owned and flow through these menu service helpers only.
- Mutating menu calls require `capabilities.adminExtensions = true`.
- Use menu keys for CRUD (`menuKey`) and location names for resolved theme-facing reads (`header`, `footer`, `dashboard`).

Route-like dispatcher for dynamic keys:
- `api.core.invoke("siteId.<siteId>.menus.list")`
- `api.core.invoke("siteId.<siteId>.menus.add", { key: "homepage", title: "Homepage", location: "header" })`
- `api.core.invoke("siteId.<siteId>.menus.location.header")`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.get")`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.edit", { title: "Main Nav", location: "header" })`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.delete")`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.items.list")`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.items.add", { title: "Posts", href: "/posts" })`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.items.<itemId>.get")`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.items.<itemId>.edit", { title: "Stories" })`
- `api.core.invoke("siteId.<siteId>.menus.<menuKey>.items.<itemId>.delete")`
- `api.core.invoke("siteId.<siteId>.taxonomy.list")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.edit", "name:New Label")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.term.<termTaxonomyId>.edit", "name:New Name")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.term.<termTaxonomyId>.meta.get")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.term.<termTaxonomyId>.meta.set", { key: "icon", value: "star" })`
- `api.core.invoke("siteId.<siteId>.data-domain.<domainKey>.<postId>.taxonomy.list")`

Short form for repeated site calls:
- `const s = api.core.forSite(siteId)`
- `s.menus.list()`
- `s.menus.byLocation("header")`
- `s.menus.get("homepage")`
- `s.menus.create({ key: "homepage", title: "Homepage", location: "header" })`
- `s.menus.update("homepage", { key: "homepage", title: "Homepage", location: "header" })`
- `s.menus.items.list("homepage")`
- `s.menus.items.create("homepage", { title: "Posts", href: "/posts" })`
- `s.taxonomy.list()`
- `s.taxonomy.edit("featured", "name:Featured Content")`
- `s.dataDomain.postTaxonomyList("post", postId)`

Example:

```js
export async function register(kernel) {
  kernel.addAction("request:begin", (ctx) => {
    if (ctx?.debug) {
      ctx.trace = [...(ctx.trace || []), "dev-tools:request:begin"];
    }
  }, 20);

  kernel.addFilter("page:meta", (meta) => ({
    ...meta,
    generator: "Tooty CMS + Dev Tools",
  }), 20);
}
```

## Dashboard integration

Plugins with `menu` / `settingsMenu` metadata are surfaced in dashboard nav via `/api/plugins/menu` when enabled.

Menu placement:

- `menuPlacement: "settings"` (default): plugin appears under `Settings > Plugins`
- `menuPlacement: "root"`: plugin appears as a root dashboard nav item
- `menuPlacement: "both"`: plugin appears in both places
- `settingsMenu` is optional and may point to a separate plugin settings screen

Recommended enterprise pattern:

- use `menu` for the primary operational workspace
- use `settingsMenu` for configuration screens
- reserve root placement for app-like plugin systems (commerce, LMS, events, CRM, etc.)

## Scope + Distribution

Plugin scope and origin are separate:

- `scope: "network" | "site"` controls governance/activation model
- `distribution: "core" | "community"` is metadata (origin tag only)

Tag model:
- `tags: string[]` is optional and multi-valued.
- Tags are normalized to lowercase slug format and deduplicated.
- Tags are registry-backed and can expand as manifests introduce new tags.

Behavior:

- `network` scope plugins are network-governed and treated as network-required when enabled.
- `site` scope plugins are site-activatable, and may be forced network-wide via global `networkRequired`.

## Global vs Site Control Surfaces

Global plugin page (`/app/settings/plugins`):

- network-admin surface
- supports `Installed` and `Community` tabs
- global enabled acts as gate/default for site plugins
- `Network` toggle can force a site plugin across sites (`networkRequired`)

Site plugin page (`/app/site/[id]/settings/plugins`):

- single-site mode:
  - acts as primary control surface
  - supports `Active` and `Community` tabs
  - updates global + site activation together
- multisite mode:
  - installed view only (community hidden)
  - shows globally enabled plugins
  - site admin can toggle site activation except network-required plugins
  - network admin can disable a network-required plugin for a specific site from site plugin screen

## UI Filtering

Installed/active list filters:

- global page: `View All`, `View Installed`, `View Uninstalled`
- site page: `View All`, `View Active`, `View Uninstalled`

Bulk actions:

- `Enable All`
- `Disable All`

## Guardrails

1. Keep plugin runtime deterministic.
2. Do not depend on mutable global state.
3. Avoid long synchronous work in hook callbacks.
4. Validate config payloads before usage.
5. Fail gracefully if plugin runtime file is missing or invalid.
6. Treat Core as the only side-effect authority; plugin writes must flow through Core extension APIs.
7. Do not bypass auth/routing/schema contracts.
8. Plugin runtime registration failures must emit trace events (`plugins` channel) for auditability.

See: `docs/EXTENSION_CONTRACTS.md`.

## Capability enforcement

Plugin capabilities are enforced at runtime:

- `hooks`: required for `kernel.addAction` / `kernel.addFilter`
- `adminExtensions`: required for dashboard/menu extension registration
- `contentTypes`: required for `api.registerContentType(...)`
- `serverHandlers`: required for governed plugin HTTP descriptors via `kernel.registerRoute(...)`
- `authExtensions`: required for governed auth provider registration via `api.registerAuthProvider(...)`. Auth transport remains core-owned through NextAuth; plugins extend provider capability only.
- `scheduleJobs`: required for scheduler APIs and `registerScheduleHandler(...)`
- `communicationProviders`: required for communication transport registration
- `webCallbacks`: required for first-class callback handler registration

If a plugin attempts a gated operation without declaring the capability, Core throws a `[plugin-guard]` error.

## Vercel/serverless notes

Tooty currently uses filesystem discovery from project folders. Deploy artifacts must include plugin folders. For future SaaS mode, plugin manifests can be promoted to a compiled registry while preserving current contracts.
