# Plugin System

Plugin system files:

- Discovery/state: `lib/plugins.ts`
- Runtime bootstrapping: `lib/plugin-runtime.ts`
- Plugin dashboard page: `app/app/(dashboard)/settings/plugins/page.tsx`
- Plugin setup route: `app/app/(dashboard)/plugins/[pluginId]/page.tsx`
- Plugin menu API: `app/api/plugins/menu/route.ts`

## Purpose

1. Support drop-in functional extensions.
2. Keep plugin state managed through settings records.
3. Expose optional plugin setup surfaces in dashboard.
4. Integrate behavior through kernel hooks, not hardcoded imports.

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
    "webCallbacks": false
  },
  "menu": { "label": "Dev Tools", "path": "/app/plugins/dev-tools" },
  "settingsFields": [
    { "key": "traceEnabled", "label": "Enable tracing", "type": "checkbox" }
  ]
}
```

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

Service-style core namespace (recommended):
- `api.core.settings.get(key, fallback?)`
- `api.core.settings.set(key, value)`
- `api.core.site.get(siteId)`
- `api.core.dataDomain.list(siteId?)`
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

Route-like dispatcher for dynamic keys:
- `api.core.invoke("siteId.<siteId>.taxonomy.list")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.edit", "name:New Label")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.term.<termTaxonomyId>.edit", "name:New Name")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.term.<termTaxonomyId>.meta.get")`
- `api.core.invoke("siteId.<siteId>.taxonomy.<taxonomyKey>.term.<termTaxonomyId>.meta.set", { key: "icon", value: "star" })`
- `api.core.invoke("siteId.<siteId>.data-domain.<domainKey>.<postId>.taxonomy.list")`

Short form for repeated site calls:
- `const s = api.core.forSite(siteId)`
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

Plugins with a `menu` object are surfaced in dashboard nav via `/api/plugins/menu` when enabled.

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
- `serverHandlers`: required for `api.registerServerHandler(...)`
- `authExtensions`: required for experimental auth extension surfaces
- `scheduleJobs`: required for scheduler APIs and `registerScheduleHandler(...)`
- `communicationProviders`: required for communication transport registration
- `webCallbacks`: required for first-class callback handler registration

If a plugin attempts a gated operation without declaring the capability, Core throws a `[plugin-guard]` error.

## Vercel/serverless notes

Tooty currently uses filesystem discovery from project folders. Deploy artifacts must include plugin folders. For future SaaS mode, plugin manifests can be promoted to a compiled registry while preserving current contracts.
