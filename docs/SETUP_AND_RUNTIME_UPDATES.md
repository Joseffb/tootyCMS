# Setup And Runtime Updates (2026-02-21)

This document summarizes the feature updates added in this cycle.

## Runtime Baseline

- Node.js `22` LTS is the supported runtime baseline for local/dev/CI/deploy.

## Local Prerequisite Install

Recommended package-manager bootstrap before `npm install`:

Required for local development + testing:
- `git`
- Node.js `22`
- `pnpm`

Required only for the full local browser matrix:
- `microsoft-edge` (optional unless you want Edge in Playwright locally)

Optional for local branded `.test` routing:
- `caddy`
- `dnsmasq`

Optional for CLI maintenance / AI-agent-assisted operations:
- `libpq` / `postgresql-client` (`psql` access)
- `neonctl` (macOS convenience CLI)
- `vercel` (env/deploy/platform operations)

macOS (Homebrew):

```bash
brew install git node@22 pnpm caddy dnsmasq libpq neonctl
brew install --cask microsoft-edge
npm install -g vercel
```

Notes:
- `git` is part of the required contributor baseline.
- Node.js `22` + `pnpm` are the required runtime/package-manager baseline for dev, tests, and CI parity.
- `libpq` provides the `psql` client for direct Postgres/Neon access.
- `neonctl` is optional, but useful if you want a dedicated Neon CLI on macOS.
- `vercel` is installed via `npm`, not Homebrew, in this setup.
- `microsoft-edge` is optional, but required if you want Edge included in the local Playwright matrix.
- `caddy` and `dnsmasq` are recommended for branded local `.test` routing.

Debian / Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates git caddy dnsmasq postgresql-client
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
npm install -g vercel
```

Notes:
- Corepack is the supported way to expose `pnpm` after Node.js `22` is installed.
- `git` + Node.js `22` + `pnpm` are the required baseline for dev, tests, and CI parity.
- `postgresql-client` provides the `psql` client for direct Postgres/Neon access.
- Tooty does not require a dedicated Neon CLI for local development; Postgres-compatible tooling is sufficient.
- `vercel` is installed via `npm`, not `apt`, in this setup.
- If you use another Node version manager, keep the runtime on Node.js `22`.

Optional browser bootstrap for local Playwright runs:

```bash
npx playwright install --with-deps chromium firefox webkit
```

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

Auth transport remains core-owned pre-v1 through the NextAuth transport layer.
External OAuth providers are plugin-delivered capability extensions registered through the kernel auth provider registry.
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

## Setup Defaults For Fresh Installs

New optional env variables:
- `SETUP_DEFAULT_THEME_ID`
- `SETUP_DEFAULT_ENABLED_PLUGINS` (comma-separated, additive)

New optional env variable:
- `ADMIN_PATH` (defaults to `cp`)

Behavior during `/setup` completion:
- core still enables `hello-teety` and `tooty-comments` by default
- any valid plugin ids in `SETUP_DEFAULT_ENABLED_PLUGINS` are also enabled globally
- site-scoped plugins from that list are enabled for the newly created main site
- if `SETUP_DEFAULT_THEME_ID` matches an installed theme, that theme is enabled and assigned to the new main site

Invalid or missing plugin/theme ids are ignored safely.

## macOS Local Domain Routing Recommendation

For macOS local development, the recommended stack for clean branded dev domains is:
- `dnsmasq` for local `.test` hostname resolution
- `Caddy` for port-80 hostname routing to app-specific high ports

Why this is recommended:
- `/etc/hosts` does not support wildcard domains
- `.test` is safe for local development, but it does not provide automatic wildcard or no-port routing
- multiple local sites can run simultaneously without competing for the same browser-visible port

Recommended topology:
- each app keeps its own internal port (`3000`, `3001`, etc.)
- direct `localhost:<port>` access remains available
- `Caddy` routes:
  - `robertbetan.test` -> `127.0.0.1:3000`
  - `fernain.test` -> `127.0.0.1:3001`

For branded local installs, pair the proxy with env values such as:
- `NEXTAUTH_URL=http://robertbetan.test`
- `NEXT_PUBLIC_ROOT_DOMAIN=robertbetan.test`
- `ADMIN_PATH=cp`

If no local reverse proxy is used, keep the explicit port in local URLs (for example `:3000`).

## Reserved Auth Extension Surface

Plugin capability surface includes:
- `authExtensions` (required for governed auth provider registration)

Guardrails:
- plugin runtime enforces declared capabilities for guarded operations
- undeclared guarded operations continue to raise `[plugin-guard]` errors
- first-party auth plugins may use this as a classification flag today, but core still owns runtime provider instantiation

## Vercel Deployment Lessons (2026-02-23)

- A project mis-set to framework `Other` can produce a deployment that reports `Ready` but serves Vercel `NOT_FOUND` for domain traffic.
- Pin framework in-repo with `vercel.json`:
  - `{ "framework": "nextjs" }`
- Keep production runtime on Node.js `22` to match `engines.node`.
- Use `DEBUG_MODE=false` for production deploys.
- Admin routes are served on the root host under `/app/{alias}`.
- By default, Core uses `/app/cp`. The internal dashboard route namespace remains `/app`.

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
