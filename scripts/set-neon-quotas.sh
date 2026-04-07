#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${NEON_API_KEY:?NEON_API_KEY is required}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID is required}"

ACTIVE_TIME_SECONDS="${ACTIVE_TIME_SECONDS:-108000}"
COMPUTE_TIME_SECONDS="${COMPUTE_TIME_SECONDS:-108000}"
WRITTEN_DATA_BYTES="${WRITTEN_DATA_BYTES:-10000000000}"
LOGICAL_SIZE_BYTES="${LOGICAL_SIZE_BYTES:-5000000000}"

curl --request PATCH \
  --url "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}" \
  --header 'Accept: application/json' \
  --header "Authorization: Bearer ${NEON_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data "{
    \"project\": {
      \"settings\": {
        \"quota\": {
          \"active_time_seconds\": ${ACTIVE_TIME_SECONDS},
          \"compute_time_seconds\": ${COMPUTE_TIME_SECONDS},
          \"written_data_bytes\": ${WRITTEN_DATA_BYTES},
          \"logical_size_bytes\": ${LOGICAL_SIZE_BYTES}
        }
      }
    }
  }"

