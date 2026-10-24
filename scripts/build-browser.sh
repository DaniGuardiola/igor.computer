#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/vm-env.sh
revision=$(python3 - <<'PYHASH'
from hashlib import sha256
from pathlib import Path
hash = sha256()
for name in ('Dockerfile', 'supervisor.py', 'windows.py', 'computer.py', 'seccomp.json'):
    data = (Path('container') / name).read_bytes()
    hash.update(name.encode() + b'\0' + len(data).to_bytes(8, 'big') + data)
print(hash.hexdigest())
PYHASH
)
current=$(docker image inspect --format '{{index .Config.Labels "ai.igor.computer.runtime-revision"}}' "$image" 2>/dev/null || true)
if [ "$current" != "$revision" ]; then
  docker build --build-arg "IGOR_RUNTIME_REVISION=$revision" -t "$image" container
fi
