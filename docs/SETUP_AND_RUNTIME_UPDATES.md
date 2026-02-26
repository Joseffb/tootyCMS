# Setup And Runtime Updates (2026-02-21)

This document summarizes the feature updates added in this cycle.

## Runtime Baseline

- Node.js `22` LTS is the supported runtime baseline for local/dev/CI/deploy.

## Setup Wizard

First-run setup is served at `/setup` until setup is marked complete.

Setup behavior:
- validates required environment fields
- saves env values using selected backend:
  - local `.env`
  - Vercel env API
  - lambda env sync endpoint
- supports optional `POSTGRES_TEST_URL` for integration/e2e isolation (falls back to `POSTGRES_URL` when empty)
- checks required prefixed DB tables before running init
- initializes schema when required
- creates or updates the first native admin user (`email` + password hash) during setup
- stores bootstrap admin metadata and marks setup complete
- requires at least one OAuth provider (`ID + Secret` pair) during setup submission

## Setup Completion Gate

Setup state now uses CMS setting keys:
- `setup_completed`
- `setup_completed_at`
- `setup_lifecycle_state`
- `setup_lifecycle_updated_at`

This prevents setup from re-appearing after a successful first run.

Lifecycle contract:
- `not_configured` -> env not saved
- `configured` -> env saved, awaiting schema readiness
- `migrated` -> schema ready/versioned, awaiting final bootstrap
- `ready` -> setup complete and runtime unlocked

## Native Admin Bootstrap Safety

Bootstrap flow:
- setup stores `bootstrap_admin_email`
- setup creates/updates the native admin row with administrator role
- first login works with native credentials immediately after setup

OAuth providers are plugin-backed and controlled by auth plugins at runtime.
Current setup gate still requires one OAuth provider pair to complete setup.

Starter content seeding safety:
- starter pages/posts are only seeded during explicit setup completion flow
- normal dashboard/runtime requests do not implicitly seed starter content

## Database Version Tracking + Explicit Apply Flow

Database update flow now tracks schema version in CMS settings:
- `db_schema_version`
- `db_schema_target_version`
- `db_schema_updated_at`

Admin "Database Updates" page provides:
- current vs target version display
- pending migration reasons
- explicit `Apply Database Update` action

## URL Canonicalization

`site_url` is now used consistently for primary-site links in dashboard contexts.

Local behavior:
- when `site_url` is missing or missing port, local links normalize to the active local port
- local port is inferred from `NEXTAUTH_URL` first, then `PORT`, then `3000`

Result:
- site cards, settings badges, analytics links, and theme render context use canonical URLs instead of hardcoded localhost fallbacks.

## Main Site Domain Display

Primary site links now resolve to root domain labels/URLs.

Legacy `main` subdomain support remains internal for route compatibility, but user-facing links prefer root-domain canonical URLs.

## Theme/Plugin Path Overrides

New optional env variables:
- `THEMES_PATH` (supports comma-separated paths)
- `PLUGINS_PATH` (supports comma-separated paths)

Behavior:
- empty/unset => default folders (`themes/`, `plugins/`)
- set => comma-separated absolute or workspace-relative paths (left-to-right priority)

Applied to:
- theme/plugin discovery
- theme template loading
- plugin runtime import
- theme asset route serving

## Experimental Auth Extension Surface

Plugin capability surface includes:
- `authExtensions` (experimental)

Guardrails:
- plugin runtime enforces declared capabilities for guarded operations
- undeclared guarded operations continue to raise `[plugin-guard]` errors

## Vercel Deployment Lessons (2026-02-23)

- A project mis-set to framework `Other` can produce a deployment that reports `Ready` but serves Vercel `NOT_FOUND` for domain traffic.
- Pin framework in-repo with `vercel.json`:
  - `{ "framework": "nextjs" }`
- Keep production runtime on Node.js `22` to match `engines.node`.
- Use `DEBUG_MODE=false` for production deploys.
- For app subdomain reachability, ensure `app.<root-domain>` has an explicit DNS record to the Vercel target from domain settings.

## Trace Pipeline Hardening (2026-02-25)

- Trace JSONL lines now include structured levels (`info|warn|error`).
- Trace sink supports retention controls:
  - `TRACE_RETENTION_DAYS` (default `14`)
  - `TRACE_MAX_FILES` (default `60`)
- Daily JSONL files are pruned by age/count on write in Node runtime.

## Secrets Guardrails In CI/Hooks (2026-02-25)

- Added local and CI secret scanning gates:
  - `npm run scan:secrets`
  - `npm run scan:secrets:staged`
- Git hooks:
  - `pre-commit` scans staged files
  - `pre-push` scans repo, runs tests, then integration tests
- CI workflow enforces secret scan before build and deploy guard stages.
