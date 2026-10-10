#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="$HOME/Applications/Igor VM.app"
mkdir -p "$HOME/Applications"
if pgrep -f "^$app/Contents/MacOS/IgorBrowser" >/dev/null; then
  printf 'Quit Igor VM before installing this build.\n' >&2
  exit 1
fi
if [ -e "$app" ] && [ "${1:-}" != --replace ]; then
  printf 'Already installed. Quit the app, then use --replace to upgrade.\n' >&2
  exit 1
fi
if [ -e "$app" ]; then
  backup=$(mktemp -d -t igor-browser-app-backup)
  ditto "$app" "$backup/Igor VM.app"
  printf 'Previous app saved in %s\n' "$backup"
fi
migration=()
legacy="$HOME/Applications/Igor Browser.app"
if [ -e "$legacy" ]; then
  # Keep the former app for rollback without leaving two installed clients.
  archive="$HOME/Library/Application Support/Igor VM/backups/legacy-app-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$archive"
  chmod 700 "$archive"
  mv "$legacy" "$archive/Igor Browser.app"
  migration=(--migrate-login)
  printf 'Previous browser app archived in %s\n' "$archive"
fi
stage=$(mktemp -d "$HOME/Applications/.igor-vm-install.XXXXXX")
trap 'rm -rf "$stage"' EXIT
ditto 'build/Igor VM.app' "$stage/Igor VM.app"
# Replace the whole bundle instead of overwriting executable inodes in place.
if [ -e "$app" ]; then mv "$app" "$backup/previous-install.app"; fi
mv "$stage/Igor VM.app" "$app"
if [ "${1:-}" = --replace ]; then shift; fi
export PATH="$app/Contents/Resources/runtime/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
bash "$app/Contents/Resources/runtime/scripts/install-server.sh" --replace
open -g "$app" --args "${migration[@]}" "$@"
