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

playwright test
