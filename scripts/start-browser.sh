#!/bin/bash
set -euo pipefail
runtime=(docker --context colima-igor-browser)
if "${runtime[@]}" container inspect igor-browser >/dev/null 2>&1; then
  "${runtime[@]}" start igor-browser
else
  "${runtime[@]}" volume create igor-browser-profile >/dev/null
  "${runtime[@]}" run -d --name igor-browser --restart unless-stopped \
    --cap-drop ALL --security-opt no-new-privileges=true \
    --security-opt "seccomp=$(cd "$(dirname "$0")/../container" && pwd)/seccomp.json" \
    --shm-size 512m --memory 2g --cpus 2 \
    -p 127.0.0.1:18422:9222 -p 127.0.0.1:18423:6080 \
    -v igor-browser-profile:/profile igor-browser:local
fi
