#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm exec vitest run tests/test-db-bootstrap.test.ts
