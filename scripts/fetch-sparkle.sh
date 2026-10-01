#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .deps/sparkle/Sparkle.framework ] && exit 0
mkdir -p .deps/sparkle
archive=$(mktemp -t igor-sparkle)
trap 'rm -f "$archive"' EXIT
curl -fL https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-2.10.0.tar.xz -o "$archive"
printf '%s  %s\n' c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c "$archive" | shasum -a 256 -c -
tar -xf "$archive" -C .deps/sparkle
