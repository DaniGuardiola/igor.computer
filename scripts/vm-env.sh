#!/bin/bash
# Shared by CLI, background service and macOS bundle. No global Docker context changes.
set -euo pipefail
export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"
vm_name=${IGOR_COMPUTER_NAME:-igor-computer}
export LIMA_HOME=${IGOR_COMPUTER_LIMA_HOME:-${LIMA_HOME:-$HOME/.lima}}
vm_dir="$LIMA_HOME/$vm_name"
export DOCKER_HOST="unix://$vm_dir/sock/docker.sock"
unset DOCKER_CONTEXT
image=igor-computer:0.2.0
container=igor-computer
