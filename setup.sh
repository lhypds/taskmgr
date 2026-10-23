#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Copied .env.example to .env"
fi

if [ ! -f taskmgr.json ]; then
  cp taskmgr.json.example taskmgr.json
  echo "Copied taskmgr.json.example to taskmgr.json"
fi

if [ ! -f data/users.json ]; then
  cp data/users.example.json data/users.json
  echo "Copied data/users.example.json to data/users.json"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable pnpm || npm install -g pnpm
  elif command -v npm >/dev/null 2>&1; then
    npm install -g pnpm
  else
    echo "Node.js/npm is required to install pnpm." >&2
    exit 1
  fi
fi

echo "Installing dependencies..."
case "$PWD" in
  # Windows drives mounted in WSL reject pnpm's default rename-based import (EACCES)
  /mnt/[a-z]/*) pnpm install --package-import-method=copy --child-concurrency=1 ;;
  *) pnpm install ;;
esac

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing pm2..."
  pnpm add -g pm2
fi

echo "Building the web UI..."
pnpm run build

echo "Done. Edit taskmgr.json (works, repositories and their task folders), data/users.json (web UI login accounts) and .env (PORT), then run ./start.sh for the web UI or ./install.sh to install taskmgr as a global command."
