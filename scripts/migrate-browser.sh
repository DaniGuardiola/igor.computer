#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/vm-env.sh
old=(docker --context colima-igor-browser)
docker info >/dev/null
if docker volume inspect igor-vm-profile >/dev/null 2>&1; then
  echo 'Target profile already exists. Refusing to overwrite browser data.' >&2
  exit 1
fi
backup_dir="$HOME/Library/Application Support/Igor VM/backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup="$backup_dir/browser-profile-$(date +%Y%m%d-%H%M%S).tar"
# Caller must close human takeover and stop the previous service before migrating.
"${old[@]}" stop --time 30 igor-browser >/dev/null
umask 077
"${old[@]}" run --rm --user 0 --entrypoint tar -v igor-browser-profile:/profile:ro igor-browser:0.1.1 -C /profile -cf - . > "$backup"
tar -tf "$backup" >/dev/null
docker volume create igor-vm-profile >/dev/null
docker run --rm -i --user 0 --entrypoint tar -v igor-vm-profile:/profile "$image" -C /profile -xf - < "$backup"
docker run --rm --user 0 --entrypoint chown -v igor-vm-profile:/profile "$image" -R 1000:1000 /profile
printf 'Profile migrated. Backup: %s\nPrevious Colima VM and profile retained for rollback.\n' "$backup"
