#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
ORIG_PATH="$PATH"

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

# pnpm needs a global bin dir on PATH. Without PNPM_HOME (a shell opened before "pnpm setup",
# or pnpm never set up) use its default one, running "pnpm setup" first when it does not exist yet.
if [ -z "$PNPM_HOME" ] && [ -z "$(pnpm config get global-bin-dir 2>/dev/null | grep -v '^undefined$')" ]; then
  export PNPM_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/pnpm"
  [ -d "$PNPM_HOME" ] || pnpm setup
  export PATH="$PNPM_HOME:$PATH"
fi

echo "Installing taskmgr globally..."
pnpm add --global "link:$PWD" $(pnpm_bin_dir_args)

echo "Done. Commands available: taskmgr, tm, taskmgr-web, taskmgrd"

# A script cannot change the PATH of the shell that ran it: when pnpm's bin dir was not on it, say so.
BIN_DIR="$(pnpm bin -g 2>/dev/null || true)"
case ":$ORIG_PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    echo "Note: $BIN_DIR is not on PATH in this terminal yet, so the commands are not found here."
    echo "Run:  source ~/.bashrc   (or open a new terminal)"
    ;;
esac
