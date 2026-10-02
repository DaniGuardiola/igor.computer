#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd "$(dirname "$0")/runtime"
colima start igor-browser --arch aarch64 --vm-type vz --cpu 2 --memory 3 --disk 20 --runtime docker --mount none --activate=false
bash scripts/build-browser.sh
bash scripts/start-browser.sh
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:18422/json/version >/dev/null; then
    exec ./bin/node src/service.mjs
  fi
  sleep 1
done
printf 'Browser did not become ready within 60 seconds.\n' >&2
exit 1
