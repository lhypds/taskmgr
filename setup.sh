#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Copied .env.example to .env"
fi

echo "Installing dependencies..."
pnpm install

echo "Done. Edit .env (TASKS_ROOT, PORT), then run ./start.sh for the web UI or ./install.sh to install taskmgr as a global command."
