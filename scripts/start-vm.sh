#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/vm-env.sh
command -v limactl >/dev/null || { echo 'Install Lima first.' >&2; exit 1; }
arch=$(uname -m)
case "$arch" in arm64|aarch64) arch=aarch64;; x86_64) arch=x86_64;; *) echo 'Unsupported host architecture.' >&2; exit 1;; esac
if [ "$(uname -s)" = Linux ] && { [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; }; then
  echo 'Enable KVM access for the server user. Software emulation is not used.' >&2
  exit 1
fi
qemu=$(command -v "qemu-system-$arch")
if [ -f "$vm_dir/igor-sleep.json" ]; then
  # Restore BEFORE any guest instruction executes. Starting then loadvm would
  # allow the fresh boot to write to disks belonging to the sleeping machine.
  node src/snapshot.mjs validate "$vm_dir" "$qemu"
  export "QEMU_SYSTEM_$(echo "$arch" | tr '[:lower:]' '[:upper:]')=$qemu -loadvm igor-sleep"
fi
resources=".cpus = ${IGOR_COMPUTER_CPUS:-2} | .memory = \"${IGOR_COMPUTER_MEMORY:-3}GiB\""
# Definition passthrough: raw Lima settings and host shares for bind mounts.
if [ -n "${IGOR_COMPUTER_LIMA_SET:-}" ]; then resources="$resources | $IGOR_COMPUTER_LIMA_SET"; fi
if [ -d "$vm_dir" ]; then
  if [ -f "$vm_dir/igor-sleep.json" ]; then
    limactl start --tty=false "$vm_name" &
    starter=$!
    # Lima regenerates cidata's instance ID on every start. Restored RAM
    # already has a ready SSH session; align its marker with the new ID.
    for attempt in $(seq 1 120); do
      if limactl shell "$vm_name" sudo python3 -c "$(cat vm/resume-guest.py)" 2>/dev/null; then
        break
      fi
      if ! kill -0 "$starter" 2>/dev/null; then break; fi
      sleep 1
    done
    wait "$starter"
  else
    # Resource changes apply on a cold start. Disk size is fixed at creation.
    if [ "$(limactl list "$vm_name" --format '{{.Status}}')" = Stopped ]; then
      limactl edit --tty=false "$vm_name" --set "$resources"
    fi
    limactl start --tty=false "$vm_name"
  fi
else
  limactl start --tty=false --name "$vm_name" \
    --set "$resources | .disk = \"${IGOR_COMPUTER_DISK:-30}GiB\" | .portForwards[1].hostPort = ${IGOR_COMPUTER_CDP_PORT:?} | .portForwards[2].hostPort = ${IGOR_COMPUTER_DISPLAY_PORT:?}" \
    vm/lima.yaml
fi
