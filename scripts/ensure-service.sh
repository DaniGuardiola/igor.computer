#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/runtime"
export PATH="$PWD/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec bash scripts/install-server.sh --ensure
