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

echo "Installing dependencies..."
pnpm install

echo "Building the web UI..."
pnpm run build

echo "Done. Edit taskmgr.json (works, projects and their task folders) and .env (PORT), then run ./start.sh for the web UI or ./install.sh to install taskmgr as a global command."
