#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="$HOME/Applications/Igor Browser.app"
mkdir -p "$HOME/Applications"
if pgrep -f "^$app/Contents/MacOS/IgorBrowser" >/dev/null; then
  printf 'Quit Igor Browser before installing this build.\n' >&2
  exit 1
fi
if [ -e "$app" ] && [ "${1:-}" != --replace ]; then
  printf 'Already installed. Quit the app, then use --replace to upgrade.\n' >&2
  exit 1
fi
if [ -e "$app" ]; then
  backup=$(mktemp -d -t igor-browser-app-backup)
  ditto "$app" "$backup/Igor Browser.app"
  printf 'Previous app saved in %s\n' "$backup"
fi
ditto 'build/Igor Browser.app' "$app"
if [ "${1:-}" = --replace ]; then shift; fi
open -g "$app" --args "$@"
