#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x .deps/node/bin/node ] && exit 0
mkdir -p .deps/node
archive=$(mktemp -t igor-node)
trap 'rm -f "$archive"' EXIT
curl -fL https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz -o "$archive"
printf '%s  %s\n' bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 "$archive" | shasum -a 256 -c -
tar -xf "$archive" --strip-components=1 -C .deps/node
