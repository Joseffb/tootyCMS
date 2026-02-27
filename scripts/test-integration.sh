#!/usr/bin/env bash
set -euo pipefail

PIDS="$(lsof -ti tcp:3000 2>/dev/null || true)"
if [[ -n "${PIDS}" ]]; then
  echo "Killing processes on :3000 -> ${PIDS}"
  kill -9 ${PIDS}
fi

set -a
source .env
if [[ -f .env.test ]]; then
  source .env.test
fi
set +a

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

playwright test
