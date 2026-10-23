@echo off
rem Windows version of restart.sh: pull the latest code, install and rebuild, then restart the web UI
rem and taskmgrd.
setlocal
cd /d "%~dp0"

echo Restarting...
echo Pulling latest code...
git pull --ff-only || exit /b 1

call "%~dp0setup.bat" || exit /b 1
call "%~dp0stop.bat"
call "%~dp0start.bat"
