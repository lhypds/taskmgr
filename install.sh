#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# pnpm refuses to link if its global bin dir is not in PATH. Some setups only
# put "$PNPM_HOME/bin" in PATH while pnpm defaults to "$PNPM_HOME"; in that
# case link into the bin/ directory that is actually on PATH.
pnpm_bin_dir_args() {
  local dir
  dir="$(pnpm config get global-bin-dir 2>/dev/null || true)"
  if [ -z "$dir" ] || [ "$dir" = "undefined" ]; then
    dir="${PNPM_HOME:-}"
  fi
  [ -n "$dir" ] || return 0
  case ":$PATH:" in
    *":$dir:"*) ;;
    *":$dir/bin:"*) echo "--config.global-bin-dir=$dir/bin" ;;
  esac
}

echo "Installing taskmgr globally..."
pnpm link $(pnpm_bin_dir_args)

echo "Done. Commands available: taskmgr, tm, taskmgr-web"
