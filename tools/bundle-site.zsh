#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TARGET=""
typeset -a THEMES

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --theme)
      if [[ -n "${2:-}" ]]; then
        THEMES+=("$2")
      fi
      shift 2
      ;;
    *)
      echo "[bundle-site] unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Usage: zsh ./tools/bundle-site.zsh --target <path> [--theme <id>]..." >&2
  exit 1
fi

if [[ "$TARGET" = /* ]]; then
  TARGET_ROOT="$TARGET"
else
  TARGET_ROOT="$(cd "$ROOT" && mkdir -p "$TARGET" && cd "$TARGET" && pwd)"
fi

mkdir -p "$TARGET_ROOT"

target_relative=""
case "$TARGET_ROOT" in
  "$ROOT")
    echo "[bundle-site] target must not be the repo root." >&2
    exit 1
    ;;
  "$ROOT"/*)
    target_relative="${TARGET_ROOT#$ROOT/}"
    ;;
esac

typeset -a RSYNC_ARGS
RSYNC_ARGS=(
  -av
  --delete
  --exclude .git
  --exclude node_modules
  --exclude .next
  --exclude coverage
  --exclude logs
  --exclude .env
  --exclude .env.local
  --exclude test-results
)

if [[ -n "$target_relative" ]]; then
  RSYNC_ARGS+=(--exclude "$target_relative/")
fi

rsync "${RSYNC_ARGS[@]}" "$ROOT/" "$TARGET_ROOT/"

theme_paths_raw="${THEMES_PATH:-themes}"
typeset -a THEME_ROOTS
IFS=',' read -rA THEME_ROOTS <<< "$theme_paths_raw"

mkdir -p "$TARGET_ROOT/themes"

for theme_id in "${THEMES[@]}"; do
  theme_source=""
  for theme_root in "${THEME_ROOTS[@]}"; do
    theme_root="${theme_root## }"
    theme_root="${theme_root%% }"
    [[ -z "$theme_root" ]] && continue
    if [[ "$theme_root" = /* ]]; then
      candidate_root="$theme_root"
    else
      candidate_root="$ROOT/$theme_root"
    fi
    candidate="$candidate_root/$theme_id"
    if [[ -f "$candidate/theme.json" ]]; then
      theme_source="$candidate"
      break
    fi
  done

  if [[ -z "$theme_source" ]]; then
    echo "[bundle-site] theme not found in THEMES_PATH: $theme_id" >&2
    exit 1
  fi

  rsync -av --delete --exclude .git "$theme_source/" "$TARGET_ROOT/themes/$theme_id/"
done

manifest_themes_json="[]"
if [[ ${#THEMES[@]} -gt 0 ]]; then
  manifest_themes_json="["
  for index in "${!THEMES[@]}"; do
    [[ "$index" -gt 1 ]] && manifest_themes_json+=", "
    manifest_themes_json+="\"${THEMES[$index]}\""
  done
  manifest_themes_json+="]"
fi

cat > "$TARGET_ROOT/.tooty-bundle.json" <<EOF
{
  "target": "$TARGET_ROOT",
  "themes": $manifest_themes_json
}
EOF

echo "[bundle-site] complete -> $TARGET_ROOT"
