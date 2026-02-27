# Kernel System

File: `lib/kernel.ts`

The kernel is the extension runtime. Everything else integrates through it.

## Responsibilities

1. Register and execute action hooks.
2. Register and execute filter hooks.
3. Register menu locations and merge menu items.
4. Guarantee deterministic execution through priority ordering.

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
- `auth:providers`
- `auth:adapter`
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
