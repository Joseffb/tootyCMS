# Versioning Policy

## Current Track

Tooty Core is in early-contract phase and uses `0.x` SemVer.

- Current core version: `0.5.0`
- Current compatibility line: `0.5.x`

## Core Bump Rules

- `0.MINOR.PATCH`
- Bump `MINOR` for breaking contract changes.
- Bump `PATCH` for non-breaking fixes, docs-only, or internal improvements.
- `1.0.0` starts only after contract freeze across routing, data-domain APIs, extension loader, and setup/runtime contracts.

## 0.5.0 AI Spine Release

`0.5.0` introduces the governed AI spine and removes the legacy direct `/api/generate` route.

This is a breaking pre-v1 contract change because:

- AI execution now requires explicit scope (`site` or `network`)
- provider dispatch is governed by the core AI spine
- plugins consume AI through the normalized spine contract instead of direct vendor calls
- the first-party `tooty-ai` plugin depends on the new `0.5.x` compatibility line

## Extension Compatibility

Plugin/theme manifests can declare:

- `version`
- `minCoreVersion`

Examples:

- `"minCoreVersion": "0.1.x"` means extension requires at least `0.1.0`.
- `"minCoreVersion": "0.2.0"` means extension is blocked on core `0.1.0`.

Incompatible extensions are skipped during discovery.
