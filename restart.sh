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
"$ROOT/start.sh"

# The sync daemon too, when this machine pushes to a server.
if grep -q '^TASKMGRD_SERVER=[[:space:]]*[^[:space:]]' "$ROOT/.env" 2>/dev/null; then
  "$ROOT/taskmgrd.sh" restart
fi
