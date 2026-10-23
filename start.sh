#!/bin/bash
# Start the web UI under pm2, and taskmgrd, the sync daemon, with it when REMOTE_SERVER is set in
# .env (both are apps of ecosystem.config.cjs; with REMOTE_SERVER empty the daemon is left out).
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
# pm2 comes from `pnpm add -g pm2`; a shell opened before `pnpm setup` does not have its folder on PATH
if ! command -v pm2 >/dev/null 2>&1 && [ -x "${PNPM_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/pnpm}/pm2" ]; then
  export PATH="${PNPM_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/pnpm}:$PATH"
fi

echo "Starting..."

cd "$ROOT"
if [ ! -d node_modules ]; then
  echo "node_modules/ not found — run ./setup.sh first" >&2
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "dist/ not found — run ./setup.sh (or pnpm run build) first" >&2
  exit 1
fi

# Read PORT / PM2_NAME from .env (same defaults as ecosystem.config.cjs)
PORT=$(grep '^PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
PM2_NAME=$(grep '^PM2_NAME=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
PORT="${PORT:-3456}"
PM2_NAME="${PM2_NAME:-taskmgr}"

# A value from .env ("KEY=value", quotes allowed); "" when the key is not there.
env_var() {
  grep "^$1=" "$ROOT/.env" 2>/dev/null | head -n 1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
# Is KEY on: 1, true, yes or on ($2 is what an unset or empty one counts as).
env_on() {
  local v
  v="$(echo "$(env_var "$1")" | tr '[:upper:]' '[:lower:]')"
  case "${v:-$2}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}
# One line on what taskmgrd, the sync daemon, does, from .env (the daemon says the same in its log).
daemon_summary() {
  local server s
  server="$(env_var REMOTE_SERVER)"
  if [ -z "$server" ]; then
    echo "taskmgrd not started (REMOTE_SERVER is empty in .env)"
    return
  fi
  if ! env_on PUSHING 1 && ! env_on POLLING 0; then
    echo "taskmgrd has nothing to do (PUSHING=0 and POLLING=0 in .env): it stops itself"
    return
  fi
  s="$(env_var POLLING_INTERVAL)"; s="${s:-600}"
  case "$s" in *[!0-9]*|'') s=600 ;; esac
  if [ $((s % 60)) -eq 0 ]; then s="$((s / 60)) min"; else s="${s}s"; fi
  echo "taskmgrd running too$(env_on PUSHING 1 && echo ", pushing to $server")$(env_on POLLING 0 && echo ", pulling from $server every $s")"
  echo "  pm2 logs taskmgrd    follow its log"
}

# `pm2 start <ecosystem>` only restarts an app that pm2 already knows by this name, keeping the
# script path and env it was first registered with. Drop any old registration so the current
# ecosystem.config.cjs (script, cwd, env) is what actually runs; the daemon too, which is dropped
# for good when REMOTE_SERVER was emptied since.
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
pm2 delete taskmgrd >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env

echo "taskmgr web UI running at http://localhost:${PORT}"
daemon_summary
