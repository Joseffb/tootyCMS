#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DIST_DIR="${NEXT_DIST_DIR:-.next-vercel-dev}"
LOCK_FILE="${REPO_ROOT}/${DIST_DIR}/dev/lock"
MANAGED_TSCONFIG_REL=".tmp/tsconfig.vercel-dev.json"
MANAGED_TSCONFIG="${REPO_ROOT}/${MANAGED_TSCONFIG_REL}"

mkdir -p "${REPO_ROOT}/.tmp"
node "${REPO_ROOT}/scripts/prepare-next-tsconfig.mjs" "${MANAGED_TSCONFIG_REL}" "${DIST_DIR}" >/dev/null

export NEXT_DIST_DIR="${DIST_DIR}"
export NEXT_TSCONFIG_PATH="${MANAGED_TSCONFIG_REL}"
export NO_UPDATE_NOTIFIER=1

if [[ -f "${LOCK_FILE}" ]]; then
  HOLDERS="$(lsof -t "${LOCK_FILE}" 2>/dev/null | tr '\n' ' ' | xargs || true)"
  if [[ -n "${HOLDERS}" ]]; then
    echo "vercel:dev aborted: ${LOCK_FILE} is already held by process(es): ${HOLDERS}" >&2
    echo "Stop the existing vercel/next dev session for ${DIST_DIR} before starting another one." >&2
    exit 1
  fi
  rm -f "${LOCK_FILE}"
fi

cd "${REPO_ROOT}"
exec vercel dev
