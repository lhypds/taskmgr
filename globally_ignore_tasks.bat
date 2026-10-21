@echo off
rem Ignore every `tasks/` folder in all git repositories through the global excludes file.
setlocal

rem Keep an excludes file that is already configured, otherwise use %USERPROFILE%\.gitignore_global.
set "EXCLUDES="
for /f "usebackq delims=" %%i in (`git config --global core.excludesFile 2^>nul`) do set "EXCLUDES=%%i"
if not defined EXCLUDES (
  set "EXCLUDES=%USERPROFILE%\.gitignore_global"
  git config --global core.excludesFile "~/.gitignore_global"
  echo Set core.excludesFile to ~/.gitignore_global
)
if "%EXCLUDES:~0,2%"=="~/" set "EXCLUDES=%USERPROFILE%\%EXCLUDES:~2%"

if not exist "%EXCLUDES%" type nul > "%EXCLUDES%"
findstr /x /c:"tasks/" "%EXCLUDES%" >nul 2>&1
if not errorlevel 1 (
  echo tasks/ is already in %EXCLUDES%
  goto :eof
)

rem Start on a new line if the file does not end with one.
powershell -NoProfile -Command "$f = $env:EXCLUDES; $t = [IO.File]::ReadAllText($f); if ($t.Length -gt 0 -and -not $t.EndsWith(\"`n\")) { [IO.File]::AppendAllText($f, \"`n\") }"
>> "%EXCLUDES%" echo tasks/
echo Added tasks/ to %EXCLUDES%
