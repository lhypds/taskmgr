#!/bin/bash
# taskmgrd: the daemon that pushes taskmgr.json and the task files of every work and repository to
# the remote tm server named in .env (TASKMGRD_SERVER, with TASKMGRD_TOKEN), run under pm2.
#
#   ./taskmgrd.sh            start it (or restart it, picking up a changed .env); ./restart.sh restarts it too
#   ./taskmgrd.sh stop       stop it
#   ./taskmgrd.sh status     is it running?
#   ./taskmgrd.sh logs       follow its log (Ctrl+C to leave; the daemon keeps running)
#   ./taskmgrd.sh fg         run it in the foreground without pm2 instead (Ctrl+C to stop)
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# The comment block at the top of this file.
usage() {
  awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"
}

die() {
  echo "$1" >&2
  exit 1
}

# A value from .env ("KEY=value", quotes allowed); "" when the key is not there.
env_var() {
  grep "^$1=" "$ROOT/.env" 2>/dev/null | head -n 1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

PM2_NAME="$(env_var TASKMGRD_PM2_NAME)"
PM2_NAME="${PM2_NAME:-taskmgrd}"

# What the daemon itself needs; checked here so a wrong .env is one message, not a pm2 restart loop.
check_setup() {
  [ -d node_modules ] || die "node_modules/ not found — run ./setup.sh first"
  [ -f taskmgr.json ] || die "taskmgr.json not found — copy taskmgr.json.example, or run tm config"
  [ -n "${TASKMGRD_SERVER:-$(env_var TASKMGRD_SERVER)}" ] || die "TASKMGRD_SERVER is not set in .env (the tm server to push to, e.g. https://tm.example.com)"
  [ -n "${TASKMGRD_TOKEN:-$(env_var TASKMGRD_TOKEN)}" ] || die "TASKMGRD_TOKEN is not set in .env (the same value as in the remote server's .env)"
}

case "${1:-start}" in
  start|restart)
    check_setup
    command -v pm2 >/dev/null 2>&1 || die "pm2 not found — pnpm add -g pm2 (or run ./setup.sh)"
    echo "Starting taskmgrd..."
    # As in start.sh: drop any old registration so the current taskmgrd.config.cjs is what runs.
    pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
    pm2 start taskmgrd.config.cjs --update-env
    echo "taskmgrd running (pm2 process \"$PM2_NAME\"), pushing to ${TASKMGRD_SERVER:-$(env_var TASKMGRD_SERVER)}"
    echo "  ./taskmgrd.sh logs    follow its log"
    echo "  ./taskmgrd.sh stop    stop it"
    echo "  pm2 startup && pm2 save   to have it start with the machine"
    ;;
  stop)
    echo "Stopping taskmgrd..."
    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
      pm2 stop "$PM2_NAME"
      echo "Stopped."
    else
      echo "$PM2_NAME was not running"
    fi
    ;;
  status)
    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
      pm2 describe "$PM2_NAME"
    else
      echo "$PM2_NAME is not running (./taskmgrd.sh to start it)"
    fi
    ;;
  logs)
    pm2 logs "$PM2_NAME"
    ;;
  fg|foreground)
    check_setup
    echo "Running taskmgrd in the foreground (Ctrl+C to stop)"
    exec node taskmgrd.js
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
