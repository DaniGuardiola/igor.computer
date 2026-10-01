#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app='build/Igor Browser.app'
[ -d "$app" ] || { printf 'Run npm run build:mac first.\n' >&2; exit 1; }
mkdir -p build/dmg
stage=$(mktemp -d -t igor-browser-dmg)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Igor Browser.app"
ln -s /Applications "$stage/Applications"
hdiutil create -volname 'Igor Browser' -srcfolder "$stage" -format UDZO -ov 'build/dmg/Igor-Browser-0.1.1-arm64.dmg'
shasum -a 256 'build/dmg/Igor-Browser-0.1.1-arm64.dmg'
