@echo off
rem Windows version of setup.sh: create .env, taskmgr.json and data\users.json from the examples,
rem install pnpm, the dependencies and pm2, and build the web UI.
setlocal
cd /d "%~dp0"

if not exist .env (
  copy .env.example .env >nul
  echo Copied .env.example to .env
)
if not exist taskmgr.json (
  copy taskmgr.json.example taskmgr.json >nul
  echo Copied taskmgr.json.example to taskmgr.json
)
if not exist data\users.json (
  copy data\users.example.json data\users.json >nul
  echo Copied data\users.example.json to data\users.json
)

where node >nul 2>&1 || (echo Node.js is required: https://nodejs.org/ 1>&2 & exit /b 1)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo Installing pnpm...
  call npm install -g pnpm || exit /b 1
)

echo Installing dependencies...
rem node_modules installed from WSL has the Linux builds of native packages: let pnpm replace them
rem without asking.
call pnpm install --config.confirmModulesPurge=false || exit /b 1

where pm2 >nul 2>&1
if errorlevel 1 (
  echo Installing pm2...
  call npm install -g pm2 || exit /b 1
)

echo Building the web UI...
call pnpm run build || exit /b 1

echo Done. Edit taskmgr.json, data\users.json and .env, then run start.bat.
