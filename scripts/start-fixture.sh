#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime=(docker --context colima-igor-browser)
"${runtime[@]}" exec igor-browser mkdir -p /tmp/igor-browser-fixture
"${runtime[@]}" cp tests/fixture.html igor-browser:/tmp/igor-browser-fixture/index.html
"${runtime[@]}" exec -d igor-browser python3 -m http.server 8080 --bind 127.0.0.1 --directory /tmp/igor-browser-fixture
