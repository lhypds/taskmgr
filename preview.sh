#!/bin/bash
# Preview the web UI in the foreground (no pm2). Ctrl+C stops it.
# Usage: ./preview.sh [tasks-root]
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "node_modules/ not found — run ./setup.sh first" >&2
  exit 1
fi

# Port: environment first, then PORT in .env, then 3456 (same order the server uses)
if [ -z "$PORT" ]; then
  PORT=$(grep '^PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
fi
PORT="${PORT:-3456}"
export PORT
URL="http://localhost:${PORT}/"

# Open the browser once the server answers (runs in the background while the server starts)
(
  for _ in $(seq 1 50); do
    if curl -sf "$URL" >/dev/null 2>&1; then
      case "$(uname)" in
        Darwin) open "$URL" ;;
        Linux) xdg-open "$URL" >/dev/null 2>&1 || true ;;
      esac
      exit 0
    fi
    sleep 0.2
  done
  echo "Server did not come up at $URL" >&2
) &

echo "Previewing taskmgr web UI at $URL (Ctrl+C to stop)"
exec node webui/server.js "$@"
