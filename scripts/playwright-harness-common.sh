#!/usr/bin/env bash

resolve_playwright_harness_port() {
  local requested_port="${PLAYWRIGHT_HARNESS_PORT:-3223}"
  node "./scripts/resolve-test-port.mjs" "${requested_port}"
}

acquire_playwright_harness_slot() {
  local requested_port="${1:-3223}"
  local candidate_port=""
  local candidate_dist_dir=""
  local candidate_lock=""

  while true; do
    candidate_port="$(node "./scripts/resolve-test-port.mjs" "${requested_port}")"
    candidate_dist_dir=".next-playwright-harness-${candidate_port}"
    candidate_lock="${candidate_dist_dir}/lock"
    mkdir -p "${candidate_dist_dir}"
    if ( set -o noclobber; : > "${candidate_lock}" ) 2>/dev/null; then
      PLAYWRIGHT_HARNESS_PORT="${candidate_port}"
      PLAYWRIGHT_HARNESS_DIST_DIR="${candidate_dist_dir}"
      PLAYWRIGHT_HARNESS_SLOT_LOCK="${candidate_lock}"
      export PLAYWRIGHT_HARNESS_PORT
      export PLAYWRIGHT_HARNESS_DIST_DIR
      export PLAYWRIGHT_HARNESS_SLOT_LOCK
      return 0
    fi
    requested_port="$((candidate_port + 1))"
  done
}

wait_for_managed_pid_exit() {
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

terminate_managed_pid() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    wait "${pid}" 2>/dev/null || true
    return 0
  fi
  kill "${pid}" >/dev/null 2>&1 || true
  if ! wait_for_managed_pid_exit "${pid}" 16; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
    wait_for_managed_pid_exit "${pid}" 16 || true
  fi
  wait "${pid}" 2>/dev/null || true
}

terminate_processes_on_port() {
  local port="${1:-}"
  local pids=""
  local pid=""
  [[ -n "${port}" ]] || return 0
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    terminate_managed_pid "${pid}"
  done < <(echo "${pids}" | tr ' ' '\n' | sort -u)
}

copy_managed_file_if_distinct() {
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

load_playwright_harness_env() {
  local harness_port="${1}"

  set -a
  source ".env"
  if [[ -f ".env.test" ]]; then
    source ".env.test"
  fi
  set +a

  export PLAYWRIGHT_HARNESS_PORT="${harness_port}"
  export NEXTAUTH_URL="${PLAYWRIGHT_HARNESS_NEXTAUTH_URL_OVERRIDE:-http://localhost:${harness_port}}"
  export NEXT_PUBLIC_ROOT_DOMAIN="${PLAYWRIGHT_HARNESS_ROOT_DOMAIN_OVERRIDE:-localhost:${harness_port}}"
  export CMS_DB_PREFIX="${PLAYWRIGHT_HARNESS_DB_PREFIX_OVERRIDE:-tooty_pw_${harness_port}_}"
  export ADMIN_PATH="${ADMIN_PATH_TEST_OVERRIDE:-cp}"
  export E2E_APP_ORIGIN="${PLAYWRIGHT_HARNESS_APP_ORIGIN_OVERRIDE:-${NEXTAUTH_URL}}"
  export E2E_PUBLIC_ORIGIN="${PLAYWRIGHT_HARNESS_PUBLIC_ORIGIN_OVERRIDE:-http://localhost:${harness_port}}"

  if [[ -z "${POSTGRES_TEST_URL:-}" ]]; then
    echo "POSTGRES_TEST_URL is required for the Playwright harness." >&2
    echo "Set POSTGRES_TEST_URL in .env or .env.test so harness traffic stays off the dev DB." >&2
    return 1
  fi

  if [[ -n "${POSTGRES_URL:-}" && "${POSTGRES_TEST_URL}" == "${POSTGRES_URL}" ]]; then
    echo "Refusing to start Playwright harness: POSTGRES_TEST_URL matches POSTGRES_URL." >&2
    return 1
  fi

  export POSTGRES_URL="${POSTGRES_TEST_URL}"
}

playwright_harness_state_dir() {
  echo "logs/playwright-harness"
}

ensure_playwright_harness_state_dir() {
  mkdir -p "$(playwright_harness_state_dir)"
}

playwright_harness_pid_file() {
  echo "$(playwright_harness_state_dir)/server.pid"
}

playwright_harness_log_file() {
  echo "$(playwright_harness_state_dir)/server.log"
}

playwright_harness_port_file() {
  echo "$(playwright_harness_state_dir)/port"
}

playwright_harness_url_file() {
  echo "$(playwright_harness_state_dir)/url"
}

playwright_harness_tsconfig_backup_file() {
  echo "$(playwright_harness_state_dir)/tsconfig.backup.json"
}

backup_root_tsconfig() {
  local backup_file
  backup_file="$(playwright_harness_tsconfig_backup_file)"
  copy_managed_file_if_distinct "tsconfig.json" "${backup_file}"
}

restore_root_tsconfig() {
  local backup_file
  backup_file="$(playwright_harness_tsconfig_backup_file)"
  if [[ -f "${backup_file}" ]]; then
    copy_managed_file_if_distinct "${backup_file}" "tsconfig.json"
    rm -f "${backup_file}"
  fi
}

release_playwright_harness_slot() {
  local slot_lock="${PLAYWRIGHT_HARNESS_SLOT_LOCK:-}"
  if [[ -n "${slot_lock}" ]]; then
    rm -f "${slot_lock}"
  fi
}

playwright_harness_is_running() {
  local pid_file
  pid_file="$(playwright_harness_pid_file)"

  [[ -f "${pid_file}" ]] || return 1

  local pid
  pid="$(cat "${pid_file}")"
  [[ -n "${pid}" ]] || return 1

  kill -0 "${pid}" >/dev/null 2>&1
}

wait_for_playwright_harness() {
  local harness_port="${1}"

  TEST_PORT="${harness_port}" node <<'NODE'
const http = require("node:http");

const port = Number(process.env.TEST_PORT || "3223");
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

  throw new Error("Timed out waiting for Playwright harness.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
}
