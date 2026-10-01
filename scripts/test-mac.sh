#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d -t igor-browser-tests)
trap 'rm -rf "$test_dir"' EXIT
swiftc -module-cache-path build/module-cache macos/SettingsReturn.swift tests/settings-return.swift -o "$test_dir/settings-return" -framework AppKit
"$test_dir/settings-return"
