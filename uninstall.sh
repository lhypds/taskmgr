#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Mirror install.sh: unlink from the same bin dir that was linked into.
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

echo "Uninstalling taskmgr..."
pnpm unlink $(pnpm_bin_dir_args)

echo "Done."
