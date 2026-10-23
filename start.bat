@echo off
rem Windows version of start.sh: start the web UI under pm2, and taskmgrd, the sync daemon, with it
rem when SYNC_SERVER is set in .env (both are apps of ecosystem.config.cjs, which reads .env).
setlocal
cd /d "%~dp0"

if not exist node_modules (echo node_modules\ not found - run setup.bat first 1>&2 & exit /b 1)
if not exist dist\index.html (echo dist\ not found - run setup.bat first 1>&2 & exit /b 1)
where pm2 >nul 2>&1 || (echo pm2 not found - run setup.bat first 1>&2 & exit /b 1)

rem PORT, PM2_NAME, SYNC_SERVER, PUSHING and POLLING from .env (same defaults as ecosystem.config.cjs)
set "PORT=3456"
set "PM2_NAME=taskmgr"
set "SYNC_SERVER="
set "PUSHING=1"
set "POLLING=0"
if exist .env for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if "%%a"=="PORT" set "PORT=%%b"
  if "%%a"=="PM2_NAME" set "PM2_NAME=%%b"
  if "%%a"=="SYNC_SERVER" set "SYNC_SERVER=%%b"
  if "%%a"=="PUSHING" set "PUSHING=%%b"
  if "%%a"=="POLLING" set "POLLING=%%b"
)
if "%PUSHING%"=="" set "PUSHING=1"

echo Starting...
rem Drop any old registration so the current ecosystem.config.cjs is what runs (see start.sh); the
rem daemon too, which is dropped for good when SYNC_SERVER was emptied since.
call pm2 delete "%PM2_NAME%" >nul 2>&1
call pm2 delete taskmgrd >nul 2>&1
call pm2 start ecosystem.config.cjs --update-env || exit /b 1
echo taskmgr web UI running at http://localhost:%PORT%

if not defined SYNC_SERVER (echo taskmgrd not started ^(SYNC_SERVER is empty in .env^) & goto :eof)
if "%PUSHING%"=="0" if "%POLLING%"=="0" (echo taskmgrd has nothing to do ^(PUSHING=0 and POLLING=0 in .env^): it stops itself & goto :eof)
echo taskmgrd running too ^(PUSHING=%PUSHING%, POLLING=%POLLING%^), server %SYNC_SERVER%
