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

## Optional: Setup Flow E2E

`tests/e2e/setup-flow.spec.ts` is destructive and opt-in:

```bash
RUN_SETUP_FLOW_E2E=1 npm run test:integration
```

Keep this pointed at `POSTGRES_TEST_URL`.
