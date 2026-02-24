# Setup And Runtime Updates (2026-02-21)

This document summarizes the feature updates added in this cycle.

## Runtime Baseline

- Node.js `22` LTS is the supported runtime baseline for local/dev/CI/deploy.

## Setup Wizard

First-run setup is served at `/setup` until setup is marked complete.

Setup behavior:
- validates required environment fields and at least one OAuth provider pair (`ID` + `SECRET`)
- saves env values using selected backend:
  - local `.env`
  - Vercel env API
  - lambda env sync endpoint
- checks required prefixed DB tables before running init
- initializes schema when required
- stores bootstrap admin metadata and marks setup complete

No user row is pre-seeded during setup. First user is created on OAuth login.

## Setup Completion Gate

Setup state now uses CMS setting keys:
- `setup_completed`
- `setup_completed_at`

This prevents setup from re-appearing after a successful first run.

## OAuth Bootstrap Safety

Bootstrap flow:
- setup stores `bootstrap_admin_email`
- first login (when user table is empty) must match bootstrap admin email
- matching first OAuth login is promoted to administrator

This avoids unsafe email auto-linking and avoids `OAuthAccountNotLinked` caused by pre-created user rows.

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
