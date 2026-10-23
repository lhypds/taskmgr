@echo off
rem Windows version of uninstall.sh: remove the commands install.bat put in npm's global folder (only
rem those that run this folder's scripts).
setlocal
cd /d "%~dp0"

set "BIN="
for /f "usebackq delims=" %%i in (`npm config get prefix`) do set "BIN=%%i"
if not defined BIN (echo Cannot find npm's global folder 1>&2 & exit /b 1)

echo Uninstalling taskmgr...
for %%n in (taskmgr tm taskmgr-web taskmgrd) do (
  if exist "%BIN%\%%n.cmd" (
    findstr /c:"%~dp0install.bat" "%BIN%\%%n.cmd" >nul 2>&1 && (del "%BIN%\%%n.cmd" & echo   removed %%n)
  )
)

echo Done.
