#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app='build/Igor VM.app'
[ -d "$app" ] || { printf 'Run npm run build:mac first.\n' >&2; exit 1; }
mkdir -p build/dmg
stage=$(mktemp -d -t igor-browser-dmg)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Igor VM.app"
ln -s /Applications "$stage/Applications"
hdiutil create -volname 'Igor VM' -srcfolder "$stage" -format UDZO -ov 'build/dmg/Igor-VM-0.2.0-arm64.dmg'
shasum -a 256 'build/dmg/Igor-VM-0.2.0-arm64.dmg'
