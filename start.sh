#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

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

# `pm2 start <ecosystem>` only restarts an app that pm2 already knows by this name, keeping the
# script path and env it was first registered with. Drop any old registration so the current
# ecosystem.config.cjs (script, cwd, env) is what actually runs.
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env

echo "taskmgr web UI running at http://localhost:${PORT}"
