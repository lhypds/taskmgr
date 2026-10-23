@echo off
rem Windows version of start.sh: start the web UI under pm2, and taskmgrd, the sync daemon, too when
rem REMOTE_SERVER is set in .env.
setlocal
cd /d "%~dp0"

if not exist node_modules (echo node_modules\ not found - run setup.bat first 1>&2 & exit /b 1)
if not exist dist\index.html (echo dist\ not found - run setup.bat first 1>&2 & exit /b 1)
where pm2 >nul 2>&1 || (echo pm2 not found - run setup.bat first 1>&2 & exit /b 1)

rem PORT, PM2_NAME and REMOTE_SERVER from .env (same defaults as ecosystem.config.cjs)
set "PORT=3456"
set "PM2_NAME=taskmgr"
set "REMOTE_SERVER="
if exist .env for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if "%%a"=="PORT" set "PORT=%%b"
  if "%%a"=="PM2_NAME" set "PM2_NAME=%%b"
  if "%%a"=="REMOTE_SERVER" set "REMOTE_SERVER=%%b"
)

echo Starting...
rem Drop any old registration so the current ecosystem.config.cjs is what runs (see start.sh).
call pm2 delete "%PM2_NAME%" >nul 2>&1
call pm2 start ecosystem.config.cjs --update-env || exit /b 1
echo taskmgr web UI running at http://localhost:%PORT%

if not defined REMOTE_SERVER goto :eof
call pm2 delete taskmgrd >nul 2>&1
call pm2 start taskmgrd.config.cjs --update-env || exit /b 1
echo taskmgrd running, pushing to %REMOTE_SERVER%
