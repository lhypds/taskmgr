#!/bin/bash

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping..."

# Read PM2_NAME from .env (same default as ecosystem.config.cjs)
PM2_NAME=$(grep '^PM2_NAME=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)
PM2_NAME="${PM2_NAME:-taskmgr}"

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 stop "$PM2_NAME"
else
  echo "$PM2_NAME was not running"
fi

echo "Stopped."
