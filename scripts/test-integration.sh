#!/usr/bin/env bash
set -euo pipefail

TEST_PORT="${TEST_PORT:-3123}"
TEST_TSCONFIG_PATH=""
ROOT_TSCONFIG_BACKUP=""
TEST_DIST_DIR=""
TEST_SLOT_LOCK=""
TEST_SERVER_LOG=""
SERVER_PID=""

wait_for_pid_exit() {
  local pid="${1:-}"
  local attempts="${2:-40}"
  local attempt
  [[ -n "${pid}" ]] || return 0
  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

terminate_pid() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    wait "${pid}" 2>/dev/null || true
    return 0
  fi
  kill "${pid}" >/dev/null 2>&1 || true
  if ! wait_for_pid_exit "${pid}" 16; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
    wait_for_pid_exit "${pid}" 16 || true
  fi
  wait "${pid}" 2>/dev/null || true
}

terminate_port_processes() {
  local port="${1:-}"
  local pids=""
  local pid=""
  [[ -n "${port}" ]] || return 0
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    terminate_pid "${pid}"
  done < <(echo "${pids}" | tr ' ' '\n' | sort -u)
}

copy_if_distinct() {
  local source_file="${1:-}"
  local target_file="${2:-}"
  [[ -n "${source_file}" && -n "${target_file}" ]] || return 0
  if [[ "$(cd "$(dirname "${source_file}")" && pwd)/$(basename "${source_file}")" == "$(cd "$(dirname "${target_file}")" && pwd)/$(basename "${target_file}")" ]]; then
    return 0
  fi
  if [[ -f "${source_file}" && -f "${target_file}" ]] && cmp -s "${source_file}" "${target_file}"; then
    return 0
  fi
  cp "${source_file}" "${target_file}"
}

acquire_test_slot() {
  local requested_port="${1:-3123}"
  local candidate_port=""
  local candidate_dist_dir=""
  local candidate_lock=""

  while true; do
    candidate_port="$(node "./scripts/resolve-test-port.mjs" "${requested_port}")"
    candidate_dist_dir=".next-test-${candidate_port}"
    candidate_lock="${candidate_dist_dir}/lock"
    mkdir -p "${candidate_dist_dir}"
    if ( set -o noclobber; : > "${candidate_lock}" ) 2>/dev/null; then
      TEST_PORT="${candidate_port}"
      TEST_DIST_DIR="${candidate_dist_dir}"
      TEST_TSCONFIG_PATH=".tsconfig.next-test-${TEST_PORT}.json"
      ROOT_TSCONFIG_BACKUP=".tsconfig.root-backup-${TEST_PORT}.json"
      TEST_SLOT_LOCK="${candidate_lock}"
      TEST_SERVER_LOG="${candidate_dist_dir}/server.log"
      export TEST_PORT
      return 0
    fi
    requested_port="$((candidate_port + 1))"
  done
}

acquire_test_slot "${TEST_PORT}"

set -a
source ".env"
if [[ -f ".env.test" ]]; then
  source ".env.test"
fi
set +a

# Integration/e2e must be stable regardless of local dev site configuration.
export NEXTAUTH_URL="${NEXTAUTH_URL_TEST_OVERRIDE:-http://localhost:${TEST_PORT}}"
export NEXT_PUBLIC_ROOT_DOMAIN="${NEXT_PUBLIC_ROOT_DOMAIN_TEST_OVERRIDE:-localhost:${TEST_PORT}}"
export CMS_DB_PREFIX="${CMS_DB_PREFIX_TEST_OVERRIDE:-tooty_test_${TEST_PORT}_}"
export ADMIN_PATH="${ADMIN_PATH_TEST_OVERRIDE:-cp}"
export E2E_APP_ORIGIN="${E2E_APP_ORIGIN_TEST_OVERRIDE:-${NEXTAUTH_URL}}"
export E2E_PUBLIC_ORIGIN="${E2E_PUBLIC_ORIGIN_TEST_OVERRIDE:-http://localhost:${TEST_PORT}}"
export PLAYWRIGHT_EXTERNAL_SERVER="1"

echo "Using integration test slot: port=${TEST_PORT} prefix=${CMS_DB_PREFIX} dist=${TEST_DIST_DIR}"

# Always evict an old test server before touching the shared test DB.
EXISTING_PIDS="$(lsof -ti "tcp:${TEST_PORT}" 2>/dev/null || true)"
if [[ -n "${EXISTING_PIDS}" ]]; then
  echo "Killing stale process(es) on test port ${TEST_PORT}: ${EXISTING_PIDS}"
  terminate_port_processes "${TEST_PORT}"
fi

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dropPrefixedTables(url, normalizedPrefix) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`SET lock_timeout = '3000ms'`);
    const tables = await client.query(
      `select tablename from pg_tables where schemaname='public' and tablename like $1 order by tablename`,
      [`${normalizedPrefix}%`],
    );
    if (tables.rows.length === 0) {
      return;
    }

    const tableList = tables.rows
      .map((row) => `"public"."${sanitizeIdentifier(String(row.tablename))}"`)
      .join(", ");
    await client.query(`DROP TABLE IF EXISTS ${tableList} CASCADE`);

    const remaining = await client.query(
      `select tablename from pg_tables where schemaname='public' and tablename like $1 order by tablename`,
      [`${normalizedPrefix}%`],
    );
    if (remaining.rows.length > 0) {
      const leftover = remaining.rows.map((row) => String(row.tablename)).join(", ");
      const error = new Error(`Integration DB reset left prefixed tables behind: ${leftover}`);
      error.code = "55P03";
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is required for integration tests.");
  const rawPrefix = (process.env.CMS_DB_PREFIX || "tooty_").trim();
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await dropPrefixedTables(url, normalizedPrefix);
      return;
    } catch (error) {
      lastError = error;
      const retryable = error && (error.code === "40P01" || error.code === "55P03");
      if (!retryable || attempt === 5) {
        throw error;
      }

      const delayMs = 250 * attempt;
      console.warn(
        `Integration DB reset retry ${attempt}/5 after ${error.code}; waiting ${delayMs}ms before retrying.`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

# Recreate latest schema from current contracts after full drop reset.
bash "./scripts/bootstrap-test-db.sh"
copy_if_distinct "tsconfig.json" "${ROOT_TSCONFIG_BACKUP}"
cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    terminate_pid "${SERVER_PID}"
  fi

  terminate_port_processes "${TEST_PORT}"

  if [[ -f "${ROOT_TSCONFIG_BACKUP}" ]]; then
    copy_if_distinct "${ROOT_TSCONFIG_BACKUP}" "tsconfig.json"
    rm -f "${ROOT_TSCONFIG_BACKUP}"
  fi

  if [[ -n "${TEST_SLOT_LOCK:-}" ]]; then
    rm -f "${TEST_SLOT_LOCK}"
  fi
}

trap cleanup EXIT

node "./scripts/prepare-next-tsconfig.mjs" "${TEST_TSCONFIG_PATH}" "${TEST_DIST_DIR}" "${ROOT_TSCONFIG_BACKUP}"
node "./scripts/prepare-next-tsconfig.mjs" "tsconfig.json" "${TEST_DIST_DIR}" "${ROOT_TSCONFIG_BACKUP}" >/dev/null

NEXT_DIST_DIR="${TEST_DIST_DIR}" NEXT_TSCONFIG_PATH="${TEST_TSCONFIG_PATH}" TRACE_PROFILE=Test node "./node_modules/next/dist/bin/next" build

if [[ -f "${ROOT_TSCONFIG_BACKUP}" ]]; then
  copy_if_distinct "${ROOT_TSCONFIG_BACKUP}" "tsconfig.json"
  rm -f "${ROOT_TSCONFIG_BACKUP}"
fi

: > "${TEST_SERVER_LOG}"
NEXT_DIST_DIR="${TEST_DIST_DIR}" NEXT_TSCONFIG_PATH="${TEST_TSCONFIG_PATH}" TRACE_PROFILE=Test node "./node_modules/next/dist/bin/next" start --port "${TEST_PORT}" >>"${TEST_SERVER_LOG}" 2>&1 &
SERVER_PID=$!

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

PLAYWRIGHT_REPORTER="${PLAYWRIGHT_REPORTER:-line}"

run_playwright() {
  CI=1 NO_COLOR=1 pnpm exec playwright test --reporter="${PLAYWRIGHT_REPORTER}" "$@"
}

has_explicit_project_arg() {
  local arg

  for arg in "$@"; do
    if [[ "${arg}" == "--project" || "${arg}" == --project=* ]]; then
      return 0
    fi
  done

  return 1
}

has_explicit_workers_arg() {
  local arg

  for arg in "$@"; do
    if [[ "${arg}" == "--workers" || "${arg}" == --workers=* ]]; then
      return 0
    fi
  done

  return 1
}

set +e
if has_explicit_project_arg "$@"; then
  run_playwright "$@"
  PLAYWRIGHT_STATUS=$?
else
  if has_explicit_workers_arg "$@"; then
    run_playwright "$@"
  elif [[ -n "${PLAYWRIGHT_INTEGRATION_WORKERS:-}" ]]; then
    run_playwright --workers="${PLAYWRIGHT_INTEGRATION_WORKERS}" "$@"
  else
    run_playwright "$@"
  fi
  PLAYWRIGHT_STATUS=$?
fi
set -e

cleanup
trap - EXIT

exit "${PLAYWRIGHT_STATUS}"
