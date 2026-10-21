#!/usr/bin/env bash
# Ignore every `tasks/` folder in all git repositories through the global excludes file.
set -e

# Keep an excludes file that is already configured, otherwise use ~/.gitignore_global.
excludes="$(git config --global core.excludesFile || true)"
if [ -z "$excludes" ]; then
  excludes="$HOME/.gitignore_global"
  git config --global core.excludesFile "$excludes"
  echo "Set core.excludesFile to $excludes"
fi
excludes="${excludes/#\~/$HOME}"

touch "$excludes"
if grep -qxF 'tasks/' "$excludes"; then
  echo "tasks/ is already in $excludes"
else
  # Start on a new line if the file does not end with one.
  [ -s "$excludes" ] && [ -n "$(tail -c1 "$excludes")" ] && echo >> "$excludes"
  echo 'tasks/' >> "$excludes"
  echo "Added tasks/ to $excludes"
fi
