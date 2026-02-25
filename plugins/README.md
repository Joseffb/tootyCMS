# Tooty CMS Plugins

Default plugin repository for **Tooty CMS**.

This repo contains official plugins used by Tooty. Community plugins are welcome.

## Purpose

- Provide stable core/site plugin modules
- Keep plugin behavior behind contracts and capabilities
- Ensure plugin safety and compatibility in CI

## Community Contributions

Community plugins are welcome via pull request.

Before opening a PR, your plugin must pass CI and follow the required rules below.

## Plugin Rules (Required)

1. One folder per plugin at repo root, e.g. `my-plugin`.
2. Folder name must match `plugin.json.id`.
3. Each plugin must include `plugin.json` with:
- `id`
- `name`
- `description`
- `version`
- `minCoreVersion`
- `scope` (`site|network`)
- `distribution` (`core|community`)
- `developer`
- `website`
- `capabilities`
4. `version` must be semver-like (example: `0.1.0`, `0.2.2-1`).
5. `minCoreVersion` must match Tooty range format (example: `0.2.x`).
6. `website` must be an absolute `http(s)` URL.
7. If `capabilities.hooks = true`, include `index.mjs`.
8. Add `tests/plugin.test.ts`.
9. Do not bypass auth/routing/schema guards.
10. Do not make direct unsafe side effects outside declared plugin contracts.
11. No secrets, binaries, malware patterns, or `.DS_Store` files.

## Quick Start: Create a Basic Plugin

1. Create a folder:
- `my-plugin/`

2. Add `my-plugin/plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Minimal Tooty plugin.",
  "version": "0.1.0",
  "minCoreVersion": "0.2.x",
  "scope": "site",
  "distribution": "community",
  "capabilities": {
    "hooks": true,
    "adminExtensions": false,
    "contentTypes": false,
    "serverHandlers": false
  },
  "menu": {
    "label": "My Plugin",
    "path": "/app/plugins/my-plugin"
  },
  "settingsFields": [],
  "developer": "Your Name",
  "website": "https://example.com"
}
```

3. Add `my-plugin/index.mjs`:

```js
export default function registerPlugin(ctx) {
  ctx.hooks?.addAction?.("request:begin", async () => {
    // plugin logic
  });
}
```

4. Add `my-plugin/tests/plugin.test.ts` (minimum contract smoke test).

5. Validate locally:

```bash
npm run ci
```

6. Open PR.

## CI

This repo runs GitHub Actions for:
- Plugin contract validation
- Security scan (secrets + suspicious patterns)
