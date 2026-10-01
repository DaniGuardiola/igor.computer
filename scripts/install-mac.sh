#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p "$HOME/Applications"
if [ -e "$HOME/Applications/Igor Browser.app" ]; then
  printf 'Igor Browser is already installed. Quit it before replacing its app bundle.\n' >&2
  exit 1
fi
ditto 'build/Igor Browser.app' "$HOME/Applications/Igor Browser.app"
open -g "$HOME/Applications/Igor Browser.app" --args --enable-login
