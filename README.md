# Tooty CMS

Tooty CMS is a multi-tenant publishing platform built on Next.js + Drizzle with a governed extension model.

## Credits

Tooty CMS includes historical lineage from the original Vercel Platforms Starter Kit. Retain original license and attribution notices where applicable.

It supports:
- Multi-site routing by domain/subdomain
- Theme-based frontend rendering (Nunjucks + theme assets)
- Plugin-based behavioral extensions (kernel hooks + core APIs)
- Taxonomy + data domains (post-type style content lanes)
- Media library with hashed uploads and derived image variants

## Core Principles

Core is authoritative for:
- Routing, auth, and security
- Database schema and writes
- Extension loading and render pipeline
- Side effects via core APIs

Extensions are governed:
- Plugins can extend behavior through typed contracts and capability flags
- Themes can extend presentation but cannot perform side effects

See:
- `docs/EXTENSION_CONTRACTS.md`
- `docs/THEME_SANDBOX_CONTRACT.md`
- `docs/ARCHITECTURE.md`

## Tech Stack

- Next.js (App Router)
- TypeScript
- Drizzle ORM + Postgres
- NextAuth
- Nunjucks (theme template rendering)
- Playwright + Vitest

## Project Layout

- `app/` — routes, API handlers, dashboard UI
- `lib/` — core domain logic (actions, runtime, themes/plugins/kernel)
- `themes/` — optional local theme folder (additional theme roots can be configured via `THEMES_PATH`)
- `plugins/` — optional local plugin folder (additional plugin roots can be configured via `PLUGINS_PATH`)
- `docs/` — architecture + contracts + subsystem docs
- `tests/` — unit and integration tests

## Theme System

Themes live in `themes/<theme-id>/` by default.
You can override source roots with `THEMES_PATH` (comma-separated absolute or workspace-relative paths).

Required:
- `theme.json`

Common files:
- `templates/home.html`
- `templates/index.html`
- `templates/header.html` (shared partial)
- `templates/footer.html` (shared partial)
- `assets/style.css`
- `assets/theme.js`
- `public/...` (served via `/theme-assets/<theme-id>/...`)

Taxonomy template hierarchy supports files like:
- `tax_category_<slug>.html`
- `category-<slug>.html`
- `category.html`
- `archive.html`
- `index.html`

Example: `themes/tooty-light/templates/tax_category_documentation.html` is used for `/c/documentation`.

## Plugin System

Plugins live in `plugins/<plugin-id>/` by default.
You can override source roots with `PLUGINS_PATH` (comma-separated absolute or workspace-relative paths).

Required:
- `plugin.json`

Optional:
- `index.mjs` exporting `register(kernel, api)`

Runtime capability flags (manifest `capabilities`) are enforced:
- `hooks`
- `adminExtensions`
- `contentTypes`
- `serverHandlers`
- `authExtensions` (experimental)

If a plugin uses undeclared capabilities, core throws `[plugin-guard]` errors.

## Local Development

Runtime baseline:
- Node.js `22` LTS

1. Install system prerequisites

Required for local development + testing:
- `git`
- Node.js `22`
- `pnpm`

Required only if you want the full local browser matrix:
- `microsoft-edge` (optional unless you want Edge included alongside Chromium, Firefox, and WebKit)

Optional for local branded domain routing:
- `caddy`
- `dnsmasq`

Optional for CLI maintenance / AI-agent-assisted ops:
- `libpq` (`psql` client for direct Postgres/Neon inspection)
- `neonctl` (dedicated Neon CLI on macOS)
- `vercel` (CLI for environment sync, deploy inspection, and platform actions)

macOS (Homebrew):

```bash
brew install git node@22 pnpm caddy dnsmasq libpq neonctl
brew install --cask microsoft-edge
npm install -g vercel
```

Notes:
- `git` is required for hooks, sync, and normal contributor workflow.
- Node.js `22` + `pnpm` are the required runtime/package-manager baseline for dev, tests, and CI parity.
- `libpq` provides the local `psql` client for direct Postgres/Neon checks.
- `neonctl` is optional, but useful if you want a dedicated Neon CLI on macOS.
- `vercel` is installed via `npm`, not Homebrew, in this setup.
- `microsoft-edge` is optional, but required if you want the full Playwright browser matrix (`chromium`, `firefox`, `webkit`, `edge`) to include Edge on macOS.
- If you use Homebrew `node@22`, ensure it is first on your shell `PATH`.

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
- `pnpm` is provided through Corepack after Node.js `22` is installed.
- `git` + Node.js `22` + `pnpm` are the required baseline for dev, tests, and CI parity.
- `postgresql-client` provides the local `psql` client for Postgres/Neon.
- Tooty does not require a dedicated Neon CLI for local development; standard Postgres tooling is enough. If you want one, install it separately for your distro.
- `vercel` is installed via `npm`, not `apt`, in this setup.
- If you prefer a different Node version manager (`nvm`, `volta`), keep the runtime at Node.js `22`.

Optional Playwright browser install (recommended for local cross-browser validation):

```bash
npx playwright install --with-deps chromium firefox webkit
```

2. Install dependencies

```bash
npm install
```

3. Configure environment

```bash
cp .env.example .env
```

Recommended for isolation:
- Set `POSTGRES_TEST_URL` to a separate Neon branch/database for integration and e2e tests.
- If `POSTGRES_TEST_URL` is empty, test scripts fall back to `POSTGRES_URL`.
- Full guide: `docs/TESTING_DB.md`

4. Run database schema push (used in build script) and start dev server

```bash
npm run dev
```

Optional but recommended:

```bash
npm run hooks:install
```

App runs at:
- `http://localhost:3000`

### macOS Recommended Local Host Routing

If you want clean local domains and multiple local sites at once, the recommended macOS setup is:
- `dnsmasq` for local `.test` name resolution
- `Caddy` for hostname-based reverse proxying to per-project ports

Why:
- `/etc/hosts` does not support wildcard domains
- `.test` is a reserved dev-safe TLD, but it does not remove the need for local DNS/proxy routing
- a reverse proxy lets you keep multiple apps running at once without browser port suffixes

Recommended pattern:
- each local app runs on its own high port
- `localhost:<port>` still works directly
- `Caddy` listens on port `80` and routes by hostname

Example:
- `example.com` and `app.example.com` -> `127.0.0.1:3000`
- `fernain.test` and `app.fernain.test` -> `127.0.0.1:3001`

Example `Caddyfile`:

```caddy
example.com, app.example.com {
  reverse_proxy 127.0.0.1:3000
}

fernain.test, app.fernain.test {
  reverse_proxy 127.0.0.1:3001
}
```

Example `dnsmasq` rules (if wildcard subdomains are desired):

```conf
address=/example.com/127.0.0.1
address=/fernain.test/127.0.0.1
```

This lets you use all of these at the same time:
- `http://localhost:3000`
- `http://example.com`
- `http://fernain.test`

Tooty env pairing for a branded local install:
- `NEXTAUTH_URL=http://example.com`
- `NEXT_PUBLIC_ROOT_DOMAIN=example.com`
- `ADMIN_PATH=cp`

If you are not using a proxy, keep the explicit dev port in those URLs.

## Vercel Deployment Guardrails

- Keep the project framework set to `Next.js`.
- This repo includes `vercel.json` (`"framework": "nextjs"`) to prevent accidental fallback to `Other`.
- If Vercel builds this app as `Other`, deploys can look "ready" but serve a platform `404 NOT_FOUND` for all domains.
- Keep runtime aligned with Node.js `22` (`engines.node`).
- Set `DEBUG_MODE=false` in production.
- For app subdomain routing, ensure `app.<root-domain>` has an explicit DNS record pointing to the Vercel target shown in your domain settings.

## Versioning Policy

Tooty is currently in pre-`1.0.0` unstable development.

- Version format in this phase is `0.MINOR.PATCH`.
- In this phase, `MINOR` is treated as the unstable major line (`0.2.x`, `0.3.x`, etc.).
- Breaking changes may occur in any `0.x` release.
- We explicitly reserve the right to make breaking changes until the project reaches `1.x.x`.
- After `1.x.x`, standard SemVer expectations apply (breaking changes only on major bumps).

## Setup Wizard

First-run setup is available at `/setup` until setup is completed.

Current setup flow:
- Load existing runtime environment values into the wizard when available
- On managed/serverless runtimes, use already-configured runtime env when present and skip persistence entirely
- On Vercel, only fall back to the Vercel env API when runtime env is not already satisfied
- Persist environment values to local `.env` only in local development
- Initialize schema (auto-check existing tables and only run init when required)
- Persist setup completion and bootstrap admin metadata
- First admin user is created on first OAuth login (no pre-seeded auth user row)

Notes:
- `site_url` is used as canonical root URL in dashboard/theme contexts.
- In local mode, missing port is normalized from `NEXTAUTH_URL` / `PORT` to avoid broken links.

## AI Editor (Optional)

AI completion is optional.

- Without `OPENAI_API_KEY`, AI completion endpoints are disabled and return a clear non-configured response.
- Core editor functionality (writing, formatting, media, taxonomy, publishing) still works without any AI key.
- You can optionally set `OPENAI_MODEL` (default: `gpt-4o-mini`) when enabling AI.

## Testing

Unit tests:

```bash
npm run test
```

Integration tests (Playwright):

```bash
npm run test:integration
```

Full suite:

```bash
npm run test:all
```

## Contributor Workflow

For non-trivial core work, use this checkpoint discipline:

1. Implement the change in `tooty-cms`.
2. Run the required green gates:
   - `npm run test`
   - `npm run test:integration`
3. If both are green, create a local checkpoint commit before starting the next substantial work chunk.

Commit guidance:
- Commit locally only unless you explicitly intend to push.
- Use a conventional commit message.
- A WIP checkpoint is acceptable when the code is validated, for example:
  - `chore: checkpoint wip`
  - `feat: checkpoint plugin admin refactor`
  - `fix: checkpoint comment provider boundary`

The goal is to preserve a known-good recovery point between larger refactors instead of carrying one giant uncommitted worktree.

## Key Docs

- `docs/ARCHITECTURE.md`
- `docs/KERNEL.md`
- `docs/PLUGINS.md`
- `docs/THEMES.md`
- `docs/EXTENSION_CONTRACTS.md`
- `docs/SETUP_AND_RUNTIME_UPDATES.md`
- `docs/SCHEDULER.md`
- `docs/THEME_SANDBOX_CONTRACT.md`
- `docs/MENUS.md`
- `docs/MEDIA_MANAGER.md`
- `docs/DATA_DOMAINS.md`
- `docs/TRACING.md`
- `docs/SECURITY_CI.md`
- `docs/TESTING_DB.md`

## Status

Current implementation includes:
- Typed plugin/theme contracts with manifest validation
- Runtime theme side-effect guardrails
- Runtime plugin capability enforcement
- Shared theme header/footer partial support
- Hash-based media object naming with variant derivation
