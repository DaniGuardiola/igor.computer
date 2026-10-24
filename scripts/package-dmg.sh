#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app='build/igor.computer.app'
[ -d "$app" ] || { printf 'Run npm run build:mac first.\n' >&2; exit 1; }
mkdir -p build/dmg
stage=$(mktemp -d -t igor-computer-dmg)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/igor.computer.app"
ln -s /Applications "$stage/Applications"
hdiutil create -volname 'igor.computer' -srcfolder "$stage" -format UDZO -ov 'build/dmg/igor.computer-0.2.0-arm64.dmg'
shasum -a 256 'build/dmg/igor.computer-0.2.0-arm64.dmg'
