#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DIST_DIR="${NEXT_DIST_DIR:-.next-vercel-dev}"
LOCK_FILE="${REPO_ROOT}/${DIST_DIR}/dev/lock"
VERCEL_CACHE_DIR="${REPO_ROOT}/.vercel/cache"
MANAGED_TSCONFIG_REL=".tmp/tsconfig.vercel-dev.json"
MANAGED_TSCONFIG="${REPO_ROOT}/${MANAGED_TSCONFIG_REL}"

mkdir -p "${REPO_ROOT}/.tmp"
node "${REPO_ROOT}/scripts/prepare-next-tsconfig.mjs" "${MANAGED_TSCONFIG_REL}" "${DIST_DIR}" >/dev/null

export NEXT_DIST_DIR="${DIST_DIR}"
export NEXT_TSCONFIG_PATH="${MANAGED_TSCONFIG_REL}"
export NO_UPDATE_NOTIFIER=1

find_repo_dev_seed_pids() {
  ps -Ao pid=,command= | awk -v repo="${REPO_ROOT}" '
    index($0, repo) && ($0 ~ /vercel\/dist\/vc\.js dev/ || $0 ~ /next\/dist\/bin\/next dev --webpack --port/) {
      print $1
    }
  '
}

collect_cleanup_pids() {
  local seed_pids=("$@")
  local all_pids=()
  local pid=""
  local parent_pid=""
  local child_pids=""

  for pid in "${seed_pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    all_pids+=("${pid}")
    parent_pid="$(ps -o ppid= -p "${pid}" 2>/dev/null | xargs || true)"
    if [[ -n "${parent_pid}" && "${parent_pid}" != "1" ]]; then
      all_pids+=("${parent_pid}")
      child_pids="$(pgrep -P "${parent_pid}" 2>/dev/null | tr '\n' ' ' | xargs || true)"
      if [[ -n "${child_pids}" ]]; then
        # shellcheck disable=SC2206
        all_pids+=(${child_pids})
      fi
    fi
    child_pids="$(pgrep -P "${pid}" 2>/dev/null | tr '\n' ' ' | xargs || true)"
    if [[ -n "${child_pids}" ]]; then
      # shellcheck disable=SC2206
      all_pids+=(${child_pids})
    fi
  done

  printf '%s\n' "${all_pids[@]}" | awk 'NF && !seen[$0]++'
}

if [[ "${ALLOW_PARALLEL_VERCEL_DEV:-0}" != "1" ]]; then
  REPO_DEV_SEEDS="$(find_repo_dev_seed_pids | tr '\n' ' ' | xargs || true)"
  if [[ -n "${REPO_DEV_SEEDS}" ]]; then
    # shellcheck disable=SC2206
    REPO_DEV_SEED_ARRAY=(${REPO_DEV_SEEDS})
    REPO_DEV_CLEANUP_PIDS="$(collect_cleanup_pids "${REPO_DEV_SEED_ARRAY[@]}" | tr '\n' ' ' | xargs || true)"
    echo "vercel:dev aborted: repo-local Next/Vercel dev process(es) are already running for ${REPO_ROOT}" >&2
    echo "Running multiple local dev servers for the same repo can revive stale route bundles and split runtime behavior." >&2
    echo "Existing process(es): ${REPO_DEV_SEEDS}" >&2
    echo "Suggested cleanup:" >&2
    echo "  kill ${REPO_DEV_CLEANUP_PIDS}" >&2
    echo "If you intentionally need parallel repo-local dev sessions, rerun with ALLOW_PARALLEL_VERCEL_DEV=1." >&2
    exit 1
  fi
fi

if [[ -f "${LOCK_FILE}" ]]; then
  HOLDERS="$(lsof -t "${LOCK_FILE}" 2>/dev/null | tr '\n' ' ' | xargs || true)"
  if [[ -n "${HOLDERS}" ]]; then
    # shellcheck disable=SC2206
    HOLDER_ARRAY=(${HOLDERS})
    CLEANUP_PIDS="$(collect_cleanup_pids "${HOLDER_ARRAY[@]}" | tr '\n' ' ' | xargs || true)"
    echo "vercel:dev aborted: ${LOCK_FILE} is already held by process(es): ${HOLDERS}" >&2
    echo "Stop the existing vercel/next dev session for ${DIST_DIR} before starting another one." >&2
    echo "Suggested cleanup:" >&2
    echo "  kill ${CLEANUP_PIDS}" >&2
    exit 1
  fi
  rm -f "${LOCK_FILE}"
fi

# Always start vercel dev from a clean dist tree so stale dev bundles cannot
# preserve outdated client/runtime behavior across restarts. Also clear the
# local Vercel cache so wrapper restarts cannot revive stale server/client
# bundles for the same route tree.
rm -rf "${REPO_ROOT:?}/${DIST_DIR}"
rm -rf "${VERCEL_CACHE_DIR}"

cd "${REPO_ROOT}"
exec vercel dev "$@"
