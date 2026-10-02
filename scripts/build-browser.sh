#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=$(shasum -a 256 container/Dockerfile container/supervisor.py container/windows.py container/seccomp.json | shasum -a 256 | awk '{print $1}')
current=$(docker --context colima-igor-browser image inspect --format '{{index .Config.Labels "ai.igor.browser.runtime-revision"}}' igor-browser:0.1.1 2>/dev/null || true)
if [ "$current" != "$revision" ]; then
  docker --context colima-igor-browser build --build-arg "IGOR_RUNTIME_REVISION=$revision" -t igor-browser:0.1.1 container
fi
