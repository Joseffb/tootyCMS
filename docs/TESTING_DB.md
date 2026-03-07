# Testing DB Setup (Any Postgres + Neon Example)

Use a dedicated Postgres test database/branch for all Playwright integration/e2e runs.

## Why

- Prevent e2e tests from mutating your dev/prod data.
- Keep CI/local test runs deterministic.
- Avoid accidental deletes/truncates on primary data.

## Required Env

Set these in `.env`:

- `POSTGRES_URL` = primary runtime DB
- `POSTGRES_TEST_URL` = dedicated test DB (Neon branch/database URL)
- `CMS_DB_PREFIX` = same table prefix used by the app (for example `tooty_`)

If `POSTGRES_TEST_URL` is set:
- `scripts/test-integration.sh` exports `POSTGRES_URL=$POSTGRES_TEST_URL` before running Playwright.
- All e2e DB clients that read `POSTGRES_URL` will use the test DB.
- Test wrappers bootstrap the DB through the core `applyPendingDatabaseMigrations()` path, not `drizzle-kit push`, so harness runs stay non-interactive under concurrency.

If `POSTGRES_TEST_URL` is empty:
- integration tests fall back to `POSTGRES_URL` (not recommended).

## Option A: Any Postgres Provider

Create a separate test database/branch using your provider of choice, then set:

```bash
POSTGRES_TEST_URL=postgresql://...
```

Examples:
- separate DB instance
- separate schema-isolated database
- separate branch/clone (if provider supports branching)

## Option B: Neon Example

Use Neon CLI with API key auth:

```bash
export NEON_API_KEY="napi_..."
```

List organizations:

```bash
neonctl orgs list --api-key "$NEON_API_KEY"
```

List projects in your org:

```bash
neonctl projects list --api-key "$NEON_API_KEY" --org-id <org-id>
```

Create a test branch in the target project:

```bash
neonctl branches create tooty-test \
  --api-key "$NEON_API_KEY" \
  --project-id <project-id>
```

Get connection string for the test branch:

```bash
neonctl connection-string tooty-test \
  --api-key "$NEON_API_KEY" \
  --project-id <project-id>
```

Put that value in:

```bash
POSTGRES_TEST_URL=postgresql://...
```

## Verify

Check env values:

```bash
rg -n "POSTGRES_URL|POSTGRES_TEST_URL|CMS_DB_PREFIX" .env
```

Run integration suite:

```bash
npm run test:integration
```

Expected behavior:
- e2e runs against test DB URL.
- primary runtime DB remains untouched by integration/e2e.
- default integration execution is one shared Playwright matrix run, not a shell loop over browsers
- chromium, firefox, webkit, and optional edge should apply pressure concurrently in the integration gate

## Optional: Setup Flow E2E

`tests/e2e/setup-flow.spec.ts` is destructive and opt-in:

```bash
RUN_SETUP_FLOW_E2E=1 npm run test:integration
```

Keep this pointed at `POSTGRES_TEST_URL`.

## Playwright Dev Harness

The Playwright dev harness is separate from `npm run test:integration`.

- `npm run test:integration` is the full release gate and must continue to exercise the four-browser matrix under load.
- The Playwright dev harness is a reusable local qualification environment for coding and debugging work between commits.

Start the harness:

```bash
npm run playwright:harness:start
```

Check status or logs:

```bash
npm run playwright:harness:status
npm run playwright:harness:logs
```

Stop it:

```bash
npm run playwright:harness:stop
```

Run a targeted qualification spec against the running harness:

```bash
npm run playwright:qualify -- tests/e2e/comments-auth-form.spec.ts
```

Behavior:

- uses `POSTGRES_TEST_URL`, never the primary runtime DB
- defaults to isolated harness prefix `tooty_pw_` unless `PLAYWRIGHT_HARNESS_DB_PREFIX_OVERRIDE` is set
- runs against a long-lived local Next dev server
- defaults to `chromium` for fast qualification unless a `--project` is explicitly passed

This harness is for developer feedback during implementation. It does not replace the mandatory four-browser `npm run test:integration` gate.
