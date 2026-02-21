# Lifecycle Hooks

Lifecycle hooks define where extensions can influence request handling and rendering.

## Hook categories

1. Request lifecycle hooks
2. Content lifecycle hooks
3. Render lifecycle hooks
4. Data transform filters

## Request lifecycle sequence

For a public render request:

1. `request:begin`
2. `render:before`
3. main layout/page render
4. `render:after`
5. `request:end`

This sequence is intentionally short and stable.

## Content lifecycle sequence

For content page routes:

1. load raw content entities
2. run `content:load` action
3. run optional transforms (`content:transform`, `render:layout`, `page:meta`)
4. render final output

## Action vs filter usage

Use actions when you need side effects:

- trace logging
- analytics events
- cache warmups

Use filters when you need transformed values:

- menu item list changes
- token overrides
- metadata overrides
- layout strategy selection

## Recommended plugin lifecycle pattern

1. Register hooks inside `register(kernel)`.
2. Keep callbacks idempotent.
3. Avoid non-deterministic side effects during static generation.
4. Prefer context-driven logic over global mutable state.

## Debug tracing pattern

A plugin can append human-readable trace markers to `context.trace` in debug mode.

```js
export async function register(kernel) {
  kernel.addAction("request:begin", (ctx) => {
    if (ctx?.debug) {
      ctx.trace = [...(ctx.trace || []), "plugin-x:request:begin"];
    }
  }, 20);
}
```

## Stability guidelines

- Do not remove lifecycle names once published.
- Add new hooks as additive contracts.
- Document payload schema changes in release notes and docs.
