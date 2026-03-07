#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source "./scripts/playwright-harness-common.sh"

COMMAND="${1:-status}"
LOG_FILE="$(playwright_harness_log_file)"
PID_FILE="$(playwright_harness_pid_file)"
PORT_FILE="$(playwright_harness_port_file)"
URL_FILE="$(playwright_harness_url_file)"
HARNESS_PORT=""
HARNESS_DIST_DIR=""
HARNESS_TSCONFIG_PATH=""

resolve_harness_paths() {
  local resolved_port="${1:-}"
  HARNESS_PORT="${resolved_port}"
  HARNESS_DIST_DIR=".next-playwright-harness-${HARNESS_PORT}"
  HARNESS_TSCONFIG_PATH=".tsconfig.playwright-harness-${HARNESS_PORT}.json"
}

start_harness() {
  ensure_playwright_harness_state_dir

  if playwright_harness_is_running; then
    resolve_harness_paths "$(cat "${PORT_FILE}" 2>/dev/null || echo "$(resolve_playwright_harness_port)")"
    echo "Playwright harness already running at $(cat "${URL_FILE}" 2>/dev/null || echo "http://localhost:${HARNESS_PORT}")"
    return 0
  fi

  acquire_playwright_harness_slot "${PLAYWRIGHT_HARNESS_PORT:-3223}"
  resolve_harness_paths "${PLAYWRIGHT_HARNESS_PORT}"
  load_playwright_harness_env "${HARNESS_PORT}"

  local stale_pids
  stale_pids="$(lsof -ti "tcp:${HARNESS_PORT}" 2>/dev/null || true)"
  if [[ -n "${stale_pids}" ]]; then
    echo "Killing stale process(es) on harness port ${HARNESS_PORT}: ${stale_pids}"
    terminate_processes_on_port "${HARNESS_PORT}"
  fi

  : > "${LOG_FILE}"

  bash "./scripts/bootstrap-test-db.sh" >>"${LOG_FILE}" 2>&1
  backup_root_tsconfig
  node "./scripts/prepare-next-tsconfig.mjs" "${HARNESS_TSCONFIG_PATH}" "${HARNESS_DIST_DIR}" "$(playwright_harness_tsconfig_backup_file)" >>"${LOG_FILE}" 2>&1
  node "./scripts/prepare-next-tsconfig.mjs" "tsconfig.json" "${HARNESS_DIST_DIR}" "$(playwright_harness_tsconfig_backup_file)" >>"${LOG_FILE}" 2>&1

  NEXT_DIST_DIR="${HARNESS_DIST_DIR}" NEXT_TSCONFIG_PATH="${HARNESS_TSCONFIG_PATH}" TRACE_PROFILE=Test node "./node_modules/next/dist/bin/next" dev --webpack --port "${HARNESS_PORT}" >>"${LOG_FILE}" 2>&1 &
  local server_pid=$!

  echo "${server_pid}" > "${PID_FILE}"
  echo "${HARNESS_PORT}" > "${PORT_FILE}"
  echo "http://localhost:${HARNESS_PORT}" > "${URL_FILE}"

  if ! wait_for_playwright_harness "${HARNESS_PORT}"; then
    restore_root_tsconfig
    rm -f "${PID_FILE}" "${PORT_FILE}" "${URL_FILE}"
    release_playwright_harness_slot
    echo "Harness failed to start. Recent log output:" >&2
    tail -n 80 "${LOG_FILE}" >&2 || true
    exit 1
  fi

  echo "Playwright harness started"
  echo "url: http://localhost:${HARNESS_PORT}"
  echo "pid: ${server_pid}"
  echo "dist: ${HARNESS_DIST_DIR}"
  echo "log: ${LOG_FILE}"
}

stop_harness() {
  ensure_playwright_harness_state_dir
  if [[ -f "${PORT_FILE}" ]]; then
    resolve_harness_paths "$(cat "${PORT_FILE}")"
  else
    resolve_harness_paths "$(resolve_playwright_harness_port)"
  fi

  if playwright_harness_is_running; then
    local pid
    pid="$(cat "${PID_FILE}")"
    terminate_managed_pid "${pid}"
  fi

  terminate_processes_on_port "${HARNESS_PORT}"

  rm -f "${PID_FILE}" "${PORT_FILE}" "${URL_FILE}"
  restore_root_tsconfig
  release_playwright_harness_slot
  echo "Playwright harness stopped"
}

status_harness() {
  ensure_playwright_harness_state_dir
  if [[ -f "${PORT_FILE}" ]]; then
    resolve_harness_paths "$(cat "${PORT_FILE}")"
  else
    resolve_harness_paths "$(resolve_playwright_harness_port)"
  fi

  if playwright_harness_is_running; then
    echo "status: running"
    echo "url: $(cat "${URL_FILE}")"
    echo "pid: $(cat "${PID_FILE}")"
    echo "dist: ${HARNESS_DIST_DIR}"
    echo "log: ${LOG_FILE}"
    return 0
  fi

  echo "status: stopped"
  echo "url: http://localhost:${HARNESS_PORT}"
  echo "dist: ${HARNESS_DIST_DIR}"
  echo "log: ${LOG_FILE}"
}

logs_harness() {
  ensure_playwright_harness_state_dir
  touch "${LOG_FILE}"
  tail -n "${PLAYWRIGHT_HARNESS_LOG_LINES:-120}" "${LOG_FILE}"
}

restart_harness() {
  stop_harness
  start_harness
}

case "${COMMAND}" in
  start)
    start_harness
    ;;
  stop)
    stop_harness
    ;;
  restart)
    restart_harness
    ;;
  status)
    status_harness
    ;;
  logs)
    logs_harness
    ;;
  *)
    echo "Usage: bash ./scripts/playwright-harness.sh {start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
