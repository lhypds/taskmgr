@echo off
rem Windows version of install.sh: install taskmgr as global commands (taskmgr, tm, taskmgr-web,
rem taskmgrd). Each is a small .cmd that runs this folder's script with node, put in npm's global
rem folder, which is on PATH wherever node is.
setlocal
cd /d "%~dp0"

where node >nul 2>&1 || (echo Node.js is required: https://nodejs.org/ 1>&2 & exit /b 1)
if not exist node_modules (echo node_modules\ not found - run setup.bat first 1>&2 & exit /b 1)

set "BIN="
for /f "usebackq delims=" %%i in (`npm config get prefix`) do set "BIN=%%i"
if not defined BIN (echo Cannot find npm's global folder 1>&2 & exit /b 1)

echo Installing taskmgr globally into %BIN%...
call :shim taskmgr cli.js || exit /b 1
call :shim tm cli.js || exit /b 1
call :shim taskmgr-web server\index.js || exit /b 1
call :shim taskmgrd taskmgrd.js || exit /b 1

echo Done. Commands available: taskmgr, tm, taskmgr-web, taskmgrd
goto :eof

:shim
(
  echo @echo off
  echo rem taskmgr command, written by %~dp0install.bat
  echo node "%~dp0%2" %%*
) > "%BIN%\%1.cmd" || exit /b 1
echo   %1
exit /b 0
