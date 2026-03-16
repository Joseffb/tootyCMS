# Kernel System

File: `lib/kernel.ts`

The kernel is the extension runtime. Everything else integrates through it.

## Responsibilities

1. Register and execute action hooks.
2. Register and execute filter hooks.
3. Register menu locations and merge menu items.
4. Guarantee deterministic execution through priority ordering.
5. Preserve generic extension contracts instead of carrying plugin-specific one-off behavior.

## Governance Constraints

- Kernel hooks and filters are shared platform contracts, not escape hatches for one plugin or one theme.
- Do not add plugin-specific or theme-specific hook semantics that only exist to satisfy a single extension.
- New hook/filter surfaces should be generic, reusable, and justified at the platform level.
- If a governance-sensitive capability needs a hard kill switch, prefer a core-team-controlled spine service plugin boundary over embedding that behavior directly into kernel-specific special cases.

## Stateful Autoloaders

Core autoloaders must check the current article/item state before fetching or re-fetching supporting data.

- Persisted item pages must prefer server-seeded state and fail closed against background autoload loops.
- Empty but loaded reference sets are authoritative state, not an invitation to retry forever.
- Draft-shell hydration may use bounded recovery fetches, but persisted items must not behave like unresolved draft shells.
- Any new editor/sidebar autoloader must document which item states can trigger it and what terminal loaded state looks like.
- Direct eager editorial taxonomy reads (`category`, `tag`) are not a fallback API for persisted item editors; those taxonomies must arrive through seeded route state and per-taxonomy eager reads must fail closed.

## Core types

- `ActionName`: predefined lifecycle events.
- `FilterName`: predefined transformation contracts.
- `MenuLocation`: named slots such as `header` or `dashboard`.
- `KernelMenuItem`: normalized nav item with ordering.

## Public API

- `createKernel()`
- `addAction(name, callback, priority?)`
- `doAction(name, payload?)`
- `addFilter(name, callback, priority?)`
- `applyFilters(name, value, context?)`
- `registerMenuLocation(location)`
- `addMenuItems(location, items)`
- `getMenuItems(location)`
- `enqueueScript(input)`
- `enqueueStyle(input)`
- `getEnqueuedAssets()`

## Enqueue Helpers

Plugins can register external or inline assets with enqueue helpers (WordPress-style ergonomics):

- `kernel.enqueueScript("https://cdn.example.com/app.js")`
- `kernel.enqueueScript({ id: "my-inline-js", inline: "console.log('hi')" })`
- `kernel.enqueueStyle("https://cdn.example.com/app.css")`
- `kernel.enqueueStyle({ id: "my-inline-css", inline: "body{--brand:#000;}" })`

Enqueued assets are rendered in public site layout and are separate from analytics consent-gated `domain:scripts`.

## Actions

Actions are for side effects. They do not return values.

### Current action contract names

- `kernel:init`
- `plugins:register`
- `themes:register`
- `menus:register`
- `domain:event`
- `communication:queued`
- `request:begin`
- `content:load`
- `comment:created`
- `comment:updated`
- `comment:deleted`
- `comment:moderated`
- `render:before`
- `render:after`
- `request:end`

## Filters

Filters transform and return values. They chain in priority order.

### Current filter contract names

- `content:transform`
- `nav:items`
- `theme:tokens`
- `page:meta`
- `render:layout`
- `admin:environment-badge`
- `admin:context-use-types`
- `admin:context-use-type`
- `admin:brand-use-type`
- `admin:floating-widgets`
- `admin:profile:sections`
- `admin:schedule-actions`
- `domain:scripts`
- `domain:query`
- `auth:callbacks:signIn`
- `auth:callbacks:jwt`
- `auth:callbacks:session`
- `communication:deliver`

## Priority rules

- Lower number executes first.
- Same priority keeps insertion order.
- Recommended defaults:
  - Core behavior: `10`
  - Normal plugin behavior: `20`
  - Late overrides: `50+`

## Error handling guidance

Kernel callbacks should be isolated per hook and fail-safe:

1. Catch callback errors.
2. Log with hook/plugin context.
3. Continue processing remaining callbacks unless the error is explicitly fatal.

## Example: action + filter registration

```ts
kernel.addAction("render:before", async (ctx) => {
  ctx.trace?.push("my-plugin:before");
}, 20);

kernel.addFilter("nav:items", (items) => {
  return [...items, { label: "Docs", href: "/docs", order: 90 }];
}, 20);
```

## Compatibility strategy

When adding new hook names, do not rename existing ones. Add new contracts and keep old contracts functional until explicitly deprecated.

`admin:brand-use-type` remains as a backward-compatible alias.
