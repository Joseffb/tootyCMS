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

Each plugin is a folder in `plugins/`.

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
  "version": "1.0.0",
  "capabilities": {
    "hooks": true,
    "adminExtensions": true,
    "contentTypes": false,
    "serverHandlers": false
  },
  "menu": { "label": "Dev Tools", "path": "/app/plugins/dev-tools" },
  "settingsFields": [
    { "key": "traceEnabled", "label": "Enable tracing", "type": "checkbox" }
  ]
}
```

## State keys

- enable key: `plugin_<id>_enabled`
- config key: `plugin_<id>_config`

## Runtime registration

If `index.mjs` exports `register(kernel, api)`, it is invoked during kernel bootstrap for enabled plugins.

`api` is an internal JS API (not REST) and provides:
- `getSiteById(siteId)`
- `getSetting(key, fallback?)`
- `setSetting(key, value)`
- `getPluginSetting(key, fallback?)`
- `setPluginSetting(key, value)`
- `listDataDomains(siteId?)`

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

## Guardrails

1. Keep plugin runtime deterministic.
2. Do not depend on mutable global state.
3. Avoid long synchronous work in hook callbacks.
4. Validate config payloads before usage.
5. Fail gracefully if plugin runtime file is missing or invalid.
6. Treat Core as the only side-effect authority; plugin writes must flow through Core extension APIs.
7. Do not bypass auth/routing/schema contracts.

See: `docs/EXTENSION_CONTRACTS.md`.

## Capability enforcement

Plugin capabilities are enforced at runtime:

- `hooks`: required for `kernel.addAction` / `kernel.addFilter`
- `adminExtensions`: required for dashboard/menu extension registration
- `contentTypes`: required for `api.registerContentType(...)`
- `serverHandlers`: required for `api.registerServerHandler(...)`

If a plugin attempts a gated operation without declaring the capability, Core throws a `[plugin-guard]` error.

## Vercel/serverless notes

Tooty currently uses filesystem discovery from project folders. Deploy artifacts must include plugin folders. For future SaaS mode, plugin manifests can be promoted to a compiled registry while preserving current contracts.
