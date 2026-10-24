#!/bin/bash
# Shared by the server and manual scripts. No global Docker context changes.
set -euo pipefail
export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"
vm_name=${IGOR_COMPUTER_VM:-igor-computer-${1:-default}}
export LIMA_HOME=${LIMA_HOME:-$HOME/.lima}
vm_dir="$LIMA_HOME/$vm_name"
export DOCKER_HOST="unix://$vm_dir/sock/docker.sock"
unset DOCKER_CONTEXT
container=igor-computer
