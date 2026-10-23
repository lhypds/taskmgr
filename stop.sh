#!/bin/bash

ROOT="$(cd "$(dirname "$0")" && pwd)"
# pm2 comes from `pnpm add -g pm2`; a shell opened before `pnpm setup` does not have its folder on PATH
if ! command -v pm2 >/dev/null 2>&1 && [ -x "${PNPM_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/pnpm}/pm2" ]; then
  export PATH="${PNPM_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/pnpm}:$PATH"
fi

echo "Stopping..."

# Read PM2_NAME from .env (same default as ecosystem.config.cjs)
PM2_NAME=$(grep '^PM2_NAME=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
PM2_NAME="${PM2_NAME:-taskmgr}"

# The web UI and taskmgrd, the sync daemon (started together by start.sh).
for name in "$PM2_NAME" taskmgrd; do
  if pm2 describe "$name" >/dev/null 2>&1; then
    pm2 stop "$name"
  else
    echo "$name was not running"
  fi
done

echo "Stopped."
