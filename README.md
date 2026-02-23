# Tooty CMS

Tooty CMS is a multi-tenant publishing platform built on Next.js + Drizzle with a governed extension model.

## Attribution

This project is based on the original **Vercel Platforms Starter Kit**:
- Original project: https://github.com/vercel/platforms
- Original authors: Vercel / Steven Tey
- License basis: MIT (retain original license and attribution notices)

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
- `themes/` — theme folders (`theme.json`, templates, assets, optional public files)
- `plugins/` — plugin folders (`plugin.json`, optional `index.mjs`)
- `docs/` — architecture + contracts + subsystem docs
- `tests/` — unit and integration tests

## Theme System

Themes live in `themes/<theme-id>/` by default.
You can override the root path with `THEMES_PATH` (absolute or workspace-relative).

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
You can override the root path with `PLUGINS_PATH` (absolute or workspace-relative).

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

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
```

3. Run database schema push (used in build script) and start dev server

```bash
npm run dev
```

App runs at:
- `http://localhost:3000`

## Setup Wizard

First-run setup is available at `/setup` until setup is completed.

Current setup flow:
- Save environment values (local `.env`, Vercel env API, or lambda backend based on runtime/backend setting)
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

## Status

Current implementation includes:
- Typed plugin/theme contracts with manifest validation
- Runtime theme side-effect guardrails
- Runtime plugin capability enforcement
- Shared theme header/footer partial support
- Hash-based media object naming with variant derivation
