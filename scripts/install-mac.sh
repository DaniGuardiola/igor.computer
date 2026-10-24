#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="$HOME/Applications/igor.computer.app"
mkdir -p "$HOME/Applications"
if pgrep -f "^$app/Contents/MacOS/IgorComputer" >/dev/null; then
  printf 'Quit igor.computer before installing this build.\n' >&2
  exit 1
fi
if [ -e "$app" ] && [ "${1:-}" != --replace ]; then
  printf 'Already installed. Quit the app, then use --replace to upgrade.\n' >&2
  exit 1
fi
if [ -e "$app" ]; then
  backup=$(mktemp -d -t igor-computer-app-backup)
  ditto "$app" "$backup/igor.computer.app"
  printf 'Previous app saved in %s\n' "$backup"
fi
stage=$(mktemp -d "$HOME/Applications/.igor-computer-install.XXXXXX")
trap 'rm -rf "$stage"' EXIT
ditto 'build/igor.computer.app' "$stage/igor.computer.app"
# Replace the whole bundle instead of overwriting executable inodes in place.
if [ -e "$app" ]; then mv "$app" "$backup/previous-install.app"; fi
mv "$stage/igor.computer.app" "$app"
if [ "${1:-}" = --replace ]; then shift; fi
export PATH="$app/Contents/Resources/runtime/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
bash "$app/Contents/Resources/runtime/scripts/install-server.sh" --replace
open -g "$app" --args "$@"
