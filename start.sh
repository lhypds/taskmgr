#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting..."

cd "$ROOT"
if [ ! -d node_modules ]; then
  echo "node_modules/ not found — run ./setup.sh first" >&2
  exit 1
fi

pm2 start ecosystem.config.cjs --update-env

# Read PORT from .env for display
PORT=$(grep '^PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 || echo 3456)

echo "taskmgr web UI running at http://localhost:${PORT:-3456}"
