#!/usr/bin/env bash
set -euo pipefail

TEST_PORT="${TEST_PORT:-3123}"
TEST_PORT="$(node ./scripts/resolve-test-port.mjs "${TEST_PORT}")"
export TEST_PORT

set -a
source .env
if [[ -f .env.test ]]; then
  source .env.test
fi
set +a

# Integration/e2e must be stable regardless of local dev site configuration.
export NEXTAUTH_URL="${NEXTAUTH_URL_TEST_OVERRIDE:-http://localhost:${TEST_PORT}}"
export NEXT_PUBLIC_ROOT_DOMAIN="${NEXT_PUBLIC_ROOT_DOMAIN_TEST_OVERRIDE:-localhost:${TEST_PORT}}"
export CMS_DB_PREFIX="${CMS_DB_PREFIX_TEST_OVERRIDE:-tooty_}"
export ADMIN_PATH="${ADMIN_PATH_TEST_OVERRIDE:-cp}"
export E2E_APP_ORIGIN="${E2E_APP_ORIGIN_TEST_OVERRIDE:-${NEXTAUTH_URL}}"
export E2E_PUBLIC_ORIGIN="${E2E_PUBLIC_ORIGIN_TEST_OVERRIDE:-http://localhost:${TEST_PORT}}"
export PLAYWRIGHT_EXTERNAL_SERVER="1"

# Integration/e2e must run against a dedicated test DB, never the dev DB.
if [[ -z "${POSTGRES_TEST_URL:-}" ]]; then
  echo "POSTGRES_TEST_URL is required for integration tests."
  echo "Set POSTGRES_TEST_URL to a dedicated test database (or define it in .env.test)."
  exit 1
fi
if [[ -n "${POSTGRES_URL:-}" && "${POSTGRES_TEST_URL}" == "${POSTGRES_URL}" ]]; then
  echo "Refusing to run integration reset: POSTGRES_TEST_URL matches POSTGRES_URL."
  echo "Use a separate test database for POSTGRES_TEST_URL."
  exit 1
fi
export POSTGRES_URL="${POSTGRES_TEST_URL}"

node <<'NODE'
const { Client } = require("pg");

function sanitizeIdentifier(input) {
  return String(input).replace(/[^a-zA-Z0-9_]/g, "_");
}

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is required for integration tests.");
  const rawPrefix = (process.env.CMS_DB_PREFIX || "tooty_").trim();
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tables = await client.query(
      `select tablename from pg_tables where schemaname='public' and tablename like $1 order by tablename`,
      [`${normalizedPrefix}%`],
    );
    if (tables.rows.length > 0) {
      const tableList = tables.rows
        .map((row) => `"public"."${sanitizeIdentifier(String(row.tablename))}"`)
        .join(", ");
      await client.query(`DROP TABLE IF EXISTS ${tableList} CASCADE`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

# Recreate latest schema from current contracts after full drop reset.
npx drizzle-kit push --config drizzle.config.ts

TEST_DIST_DIR=".next-test-${TEST_PORT}"
NEXT_DIST_DIR="${TEST_DIST_DIR}" TRACE_PROFILE=Test node ./node_modules/next/dist/bin/next build

EXISTING_PIDS="$(lsof -ti tcp:${TEST_PORT} 2>/dev/null || true)"
if [[ -n "${EXISTING_PIDS}" ]]; then
  echo "Killing stale process(es) on test port ${TEST_PORT}: ${EXISTING_PIDS}"
  echo "${EXISTING_PIDS}" | xargs kill >/dev/null 2>&1 || true
  sleep 1
fi

NEXT_DIST_DIR="${TEST_DIST_DIR}" TRACE_PROFILE=Test node ./node_modules/next/dist/bin/next start --port "${TEST_PORT}" &
SERVER_PID=$!

cleanup() {
  if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

node <<'NODE'
const http = require("node:http");

const port = Number(process.env.TEST_PORT || "3123");
const timeoutMs = 120_000;
const deadline = Date.now() + timeoutMs;

function check() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/icon.svg",
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        reject(new Error(`Unexpected status ${res.statusCode}`));
      },
    );
    req.on("error", reject);
    req.setTimeout(2_000, () => req.destroy(new Error("timeout")));
  });
}

(async () => {
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for integration web server.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

set +e
pnpm exec playwright test "$@"
PLAYWRIGHT_STATUS=$?
set -e

cleanup
trap - EXIT

exit "${PLAYWRIGHT_STATUS}"
