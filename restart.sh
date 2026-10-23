#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Restarting..."

cd "$ROOT"
echo "Pulling latest code..."
git pull --ff-only

# Installs dependencies and rebuilds the web UI
"$ROOT/setup.sh"

"$ROOT/stop.sh"
"$ROOT/start.sh"   # the sync daemon too, when REMOTE_SERVER is set in .env
