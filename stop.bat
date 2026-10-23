@echo off
rem Windows version of stop.sh: stop the web UI and taskmgrd.
setlocal
cd /d "%~dp0"

set "PM2_NAME=taskmgr"
if exist .env for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if "%%a"=="PM2_NAME" set "PM2_NAME=%%b"
)

echo Stopping...
for %%n in ("%PM2_NAME%" taskmgrd) do (
  call pm2 describe %%n >nul 2>&1 && call pm2 stop %%n || echo %%~n was not running
)
echo Stopped.
