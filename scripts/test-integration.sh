#!/usr/bin/env bash
set -euo pipefail

PIDS="$(lsof -ti tcp:3000 2>/dev/null || true)"
if [[ -n "${PIDS}" ]]; then
  echo "Killing processes on :3000 -> ${PIDS}"
  kill -9 ${PIDS}
fi

set -a
source .env
set +a

# Force all integration/e2e DB clients to use dedicated test DB when provided.
if [[ -n "${POSTGRES_TEST_URL:-}" ]]; then
  export POSTGRES_URL="${POSTGRES_TEST_URL}"
fi

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
  const usersTable = sanitizeIdentifier(`${normalizedPrefix}users`);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`ALTER TABLE "${usersTable}" ADD COLUMN IF NOT EXISTS "authProvider" text NOT NULL DEFAULT 'native'`);
    await client.query(`ALTER TABLE "${usersTable}" ADD COLUMN IF NOT EXISTS "passwordHash" text`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

playwright test
