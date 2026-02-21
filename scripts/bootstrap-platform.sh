#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
TB_DEFAULT_HOST="https://api.us-east.aws.tinybird.co"

log() {
  printf '[bootstrap] %s\n' "$1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example "$ENV_FILE"
      log "Created $ENV_FILE from .env.example"
    else
      touch "$ENV_FILE"
      log "Created empty $ENV_FILE"
    fi
  fi
}

get_env() {
  local key="$1"
  awk -F= -v k="$key" '$1==k {sub($1"=",""); print; exit}' "$ENV_FILE"
}

set_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i '' "s/^${key}=.*/${key}=${escaped}/" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

read_vercel_ids() {
  if [[ ! -f .vercel/project.json ]]; then
    return
  fi

  if has_cmd jq; then
    local project_id org_id
    project_id=$(jq -r '.projectId // empty' .vercel/project.json)
    org_id=$(jq -r '.orgId // empty' .vercel/project.json)
    [[ -n "$project_id" ]] && set_env PROJECT_ID_VERCEL "$project_id"
    [[ -n "$org_id" ]] && set_env TEAM_ID_VERCEL "$org_id"
  fi
}

setup_vercel() {
  if ! has_cmd vercel; then
    log "Vercel CLI not found; skipping Vercel setup"
    return
  fi

  if ! vercel whoami >/dev/null 2>&1; then
    log "Vercel CLI is installed but not logged in; skipping Vercel setup"
    return
  fi

  if [[ ! -f .vercel/project.json ]]; then
    local project_name
    project_name="${VERCEL_PROJECT_NAME:-$(basename "$ROOT_DIR" | tr '[:upper:] ' '[:lower:]-')}"
    log "Creating/linking Vercel project: $project_name"
    vercel project add "$project_name" >/dev/null 2>&1 || true
    vercel link --yes --project "$project_name" >/dev/null
  else
    log "Vercel project already linked; skipping project creation"
  fi

  read_vercel_ids

  local root_domain
  root_domain="$(get_env NEXT_PUBLIC_ROOT_DOMAIN)"
  if [[ -n "$root_domain" && "$root_domain" != "localhost" && "$root_domain" != "vercel.pub" ]]; then
    if ! vercel domains inspect "$root_domain" >/dev/null 2>&1; then
      log "Attaching domain to Vercel: $root_domain"
      vercel domains add "$root_domain" >/dev/null || true
    else
      log "Domain already present on Vercel; skipping domain attach"
    fi
  fi
}

extract_tb_token_id() {
  local token_name="$1"
  tb --cloud token ls 2>/dev/null | awk -v wanted="$token_name" '
    /^id:/ {id=$2}
    /^name:/ {
      name=$2
      if (name == wanted) {
        print id
        exit
      }
    }
  '
}

setup_tinybird() {
  if ! has_cmd tb; then
    log "Tinybird CLI not found; skipping Tinybird setup"
    return
  fi

  if ! tb --cloud workspace current >/dev/null 2>&1; then
    log "Tinybird CLI is installed but not authenticated; skipping Tinybird setup"
    return
  fi

  local workspace_name
  workspace_name="${TB_WORKSPACE_NAME:-}"
  if [[ -n "$workspace_name" ]]; then
    if ! tb --cloud workspace ls | grep -q "name: ${workspace_name}"; then
      log "Creating Tinybird workspace: $workspace_name"
      tb --cloud workspace create "$workspace_name" >/dev/null
    fi
    tb --cloud workspace use "$workspace_name" >/dev/null
  fi

  if [[ -d tinybird ]]; then
    log "Deploying Tinybird project"
    (
      cd tinybird
      tb --cloud deploy --check >/dev/null
      tb --cloud deploy --wait --auto >/dev/null
    )
  fi

  local tb_host
  if [[ -f .tinyb ]] && has_cmd jq; then
    tb_host=$(jq -r '.host // empty' .tinyb)
  else
    tb_host=""
  fi
  set_env NEXT_PUBLIC_TB_HOST "${tb_host:-$TB_DEFAULT_HOST}"

  local ingest_token dash_token
  ingest_token="$(get_env TB_INGEST_TOKEN)"
  dash_token="$(get_env TB_DASH_TOKEN)"

  if [[ -z "$ingest_token" ]]; then
    local tracker_id
    tracker_id="$(extract_tb_token_id tracker || true)"
    if [[ -n "$tracker_id" ]]; then
      ingest_token="$(tb --cloud token copy "$tracker_id" | tr -d '\r\n')"
      set_env TB_INGEST_TOKEN "$ingest_token"
      log "Set TB_INGEST_TOKEN from Tinybird tracker token"
    fi
  else
    log "TB_INGEST_TOKEN already set; skipping"
  fi

  if [[ -z "$dash_token" ]]; then
    local dashboard_id
    dashboard_id="$(extract_tb_token_id dashboard || true)"
    if [[ -n "$dashboard_id" ]]; then
      dash_token="$(tb --cloud token copy "$dashboard_id" | tr -d '\r\n')"
      set_env TB_DASH_TOKEN "$dash_token"
      log "Set TB_DASH_TOKEN from Tinybird dashboard token"
    fi
  else
    log "TB_DASH_TOKEN already set; skipping"
  fi
}

setup_neon() {
  local pg_url
  pg_url="$(get_env POSTGRES_URL)"
  if [[ -n "$pg_url" ]]; then
    log "POSTGRES_URL already set; skipping Neon provisioning"
    return
  fi

  if ! has_cmd neon; then
    log "Neon CLI not found; skipping Neon provisioning"
    return
  fi

  if ! neon auth whoami >/dev/null 2>&1; then
    log "Neon CLI is installed but not logged in; skipping Neon provisioning"
    return
  fi

  log "Neon CLI is available, but automatic project/db creation is not configured in this script yet."
  log "Set POSTGRES_URL manually or extend scripts/bootstrap-platform.sh with your Neon flow."
}

main() {
  ensure_env_file
  setup_vercel
  setup_tinybird
  setup_neon
  log "Bootstrap complete"
}

main "$@"
