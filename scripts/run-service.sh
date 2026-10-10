#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if [ -d "$(dirname "$0")/runtime" ]; then
  cd "$(dirname "$0")/runtime"
  export PATH="$PWD/bin:$PATH"
else
  cd "$(dirname "$0")/.."
fi
export PATH="$PWD/bin:$PATH"
exec node src/service.mjs
