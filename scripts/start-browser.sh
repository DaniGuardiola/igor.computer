#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/vm-env.sh
if docker container inspect "$container" >/dev/null 2>&1; then
  current=$(docker inspect --format '{{.Image}}' "$container")
  desired=$(docker image inspect --format '{{.Id}}' "$image")
  if [ "$current" != "$desired" ]; then
    docker stop --time 30 "$container" >/dev/null
    docker rm "$container" >/dev/null
  fi
fi
if docker container inspect "$container" >/dev/null 2>&1; then
  docker start "$container"
else
  docker volume create igor-computer-profile >/dev/null
  docker volume create igor-computer-home >/dev/null
  docker volume create igor-computer-workspace >/dev/null
  docker run -d --name "$container" --restart unless-stopped \
    --cap-drop ALL --security-opt no-new-privileges=true \
    --security-opt "seccomp=$PWD/container/seccomp.json" \
    --shm-size 512m --memory 2g --cpus 2 \
    -p 127.0.0.1:18422:9222 -p 127.0.0.1:18423:6080 \
    -v igor-computer-profile:/profile -v igor-computer-home:/home/browser \
    -v igor-computer-workspace:/workspace "$image"
fi
