#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source "./scripts/playwright-harness-common.sh"

HARNESS_PORT="$(resolve_playwright_harness_port)"
load_playwright_harness_env "${HARNESS_PORT}"

if ! playwright_harness_is_running; then
  echo "Playwright harness is not running." >&2
  echo "Start it first with: npm run playwright:harness:start" >&2
  exit 1
fi

export PLAYWRIGHT_EXTERNAL_SERVER="1"
export TEST_PORT="${HARNESS_PORT}"

REPORTER="${PLAYWRIGHT_REPORTER:-line}"

has_explicit_project_arg() {
  local arg
  for arg in "$@"; do
    if [[ "${arg}" == "--project" || "${arg}" == --project=* ]]; then
      return 0
    fi
  done
  return 1
}

if has_explicit_project_arg "$@"; then
  CI=1 NO_COLOR=1 pnpm exec playwright test --reporter="${REPORTER}" "$@"
else
  CI=1 NO_COLOR=1 pnpm exec playwright test --reporter="${REPORTER}" --project=chromium "$@"
fi
