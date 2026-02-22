# Versioning Policy

## Current Track

Tooty Core is in early-contract phase and uses `0.x` SemVer.

- Current core version: `0.1.0`
- Current compatibility line: `0.1.x`

## Core Bump Rules

- `0.MINOR.PATCH`
- Bump `MINOR` for breaking contract changes.
- Bump `PATCH` for non-breaking fixes, docs-only, or internal improvements.
- `1.0.0` starts only after contract freeze across routing, data-domain APIs, extension loader, and setup/runtime contracts.

## Extension Compatibility

Plugin/theme manifests can declare:

- `version`
- `minCoreVersion`

Examples:

- `"minCoreVersion": "0.1.x"` means extension requires at least `0.1.0`.
- `"minCoreVersion": "0.2.0"` means extension is blocked on core `0.1.0`.

Incompatible extensions are skipped during discovery.
