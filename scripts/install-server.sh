#!/bin/bash
set -euo pipefail
source_dir=$(cd "$(dirname "$0")/.." && pwd)
if [ "$(uname -s)" = Darwin ]; then
  server_dir="$HOME/Library/Application Support/igor.computer/server"
  log_dir="$HOME/Library/Logs/igor.computer"
else
  server_dir="${XDG_DATA_HOME:-$HOME/.local/share}/igor-computer/server"
  log_dir="${XDG_STATE_HOME:-$HOME/.local/state}/igor-computer"
fi
mkdir -p "$server_dir" "$log_dir"
revision=$(python3 - "$source_dir" <<'HASH'
from pathlib import Path
import hashlib, sys
root=Path(sys.argv[1]); digest=hashlib.sha256()
for folder in ('src','scripts','container','vm','node_modules'):
    for file in sorted((root/folder).rglob('*')):
        if file.is_file():
            digest.update(str(file.relative_to(root)).encode()); digest.update(file.read_bytes())
print(digest.hexdigest())
HASH
)
previous=$(cat "$server_dir/version.txt" 2>/dev/null || true)
version=$(python3 - "$source_dir" <<'VERSION'
import json, os, sys
from pathlib import Path
root=Path(sys.argv[1])
if (root/'server-version.json').exists(): value=json.loads((root/'server-version.json').read_text())
else: value={'version':json.loads((root/'package.json').read_text())['version'] if (root/'package.json').exists() else '0.2.0','build':int(os.environ.get('IGOR_BUILD_NUMBER','3'))}
print(json.dumps(value))
VERSION
)
if [ "${1:-}" = --ensure ] && [ -f "$server_dir/server-version.json" ]; then
  if python3 - "$version" "$server_dir/server-version.json" <<'COMPARE'
import json, sys
new, old=json.loads(sys.argv[1]),json.load(open(sys.argv[2]))
def version(value): return tuple(int(part) for part in value['version'].split('.'))+(int(value['build']),)
sys.exit(0 if version(new)<=version(old) else 1)
COMPARE
  then revision="$previous"; fi
fi
if [ ! -f "$server_dir/src/service.mjs" ] || [ "$previous" != "$revision" ] || [ "${1:-}" = --replace ]; then
  if [ -f "$server_dir/src/service.mjs" ]; then
    checker="$source_dir/bin/node"
    [ -x "$checker" ] || checker=$(command -v node)
    if ! "$checker" --input-type=module - "$source_dir" <<'CHECK'
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
const {stateDir,port,origin}=await import(pathToFileURL(process.argv[2]+'/src/config.mjs'));
let response;
try {
  const token=(await readFile(stateDir+'/token','utf8')).trim();
  response=await fetch('http://127.0.0.1:'+port+'/computers',{headers:{Authorization:'Bearer '+token,Host:new URL(origin).host},signal:AbortSignal.timeout(3000)});
} catch(error) { if(error.code!=='ENOENT' && error.cause?.code!=='ECONNREFUSED') throw error; }
if(response){
  if(!response.ok) throw new Error('Cannot safely inspect server ownership for update.');
  const {computers}=await response.json();
  const busy=computers.find(item=>item.mode==='human' || item.activeTurns || ['waking','saving','building'].includes(item.state));
  if(busy) throw new Error(`Computer ${busy.name} is in use. Finish its turn or human takeover before updating the server.`);
}
CHECK
    then
      # An app update must not fail startup: keep the running server and retry on the next launch.
      [ "${1:-}" = --ensure ] || exit 1
      printf 'Server update deferred until the next app launch.\n' >&2
      deferred=1
    fi
  fi
fi
if [ -z "${deferred:-}" ] && { [ ! -f "$server_dir/src/service.mjs" ] || [ "$previous" != "$revision" ] || [ "${1:-}" = --replace ]; }; then
  # Installer updates the independent server bundle, never the guest's data.
  if [ "$(uname -s)" = Darwin ]; then
    launchctl bootout "gui/$(id -u)/ai.igor.computer.server" 2>/dev/null || true
  else
    systemctl --user stop igor-computer.service 2>/dev/null || true
  fi
  if [ "$source_dir" != "$server_dir" ]; then
  for directory in src scripts container vm node_modules; do
    rm -rf "$server_dir/$directory"
    cp -R "$source_dir/$directory" "$server_dir/$directory"
  done
  mkdir -p "$server_dir/bin"
  if [ -x "$source_dir/bin/node" ]; then cp "$source_dir/bin/node" "$server_dir/bin/node.new";
  elif [ -x "$source_dir/.deps/node/bin/node" ]; then cp "$source_dir/.deps/node/bin/node" "$server_dir/bin/node.new";
  else cp "$(command -v node)" "$server_dir/bin/node.new"; fi
  # A fresh inode avoids macOS retaining the previous executable code signature.
  mv -f "$server_dir/bin/node.new" "$server_dir/bin/node"
  printf '#!/bin/bash\nexec "%s/bin/node" "%s/src/cli.mjs" "$@"\n' "$server_dir" "$server_dir" > "$server_dir/bin/igor-computer"
  chmod 755 "$server_dir/bin/igor-computer"
  fi
  printf '%s\n' "$revision" > "$server_dir/version.txt"
  printf '%s\n' "$version" > "$server_dir/server-version.json"
fi
if [ "$(uname -s)" = Darwin ]; then
  plist="$HOME/Library/LaunchAgents/ai.igor.computer.server.plist"
  mkdir -p "$(dirname "$plist")"
  python3 - "$plist" "$server_dir" "$log_dir" <<'PY'
import plistlib, sys
path, root, logs = sys.argv[1:]
with open(path, 'wb') as file:
    plistlib.dump(dict(Label='ai.igor.computer.server', ProgramArguments=['/bin/bash',root+'/scripts/run-service.sh'],
        RunAtLoad=True, KeepAlive=True, ThrottleInterval=10,
        StandardOutPath=logs+'/server.log', StandardErrorPath=logs+'/server.log',
        EnvironmentVariables=dict(PATH=root+'/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')), file)
PY
  if ! launchctl print "gui/$(id -u)/ai.igor.computer.server" >/dev/null 2>&1; then
    launchctl bootstrap "gui/$(id -u)" "$plist"
  fi
else
  mkdir -p "$HOME/.config/systemd/user"
  python3 - "$HOME/.config/systemd/user/igor-computer.service" "$server_dir" <<'PY'
import sys
from pathlib import Path
path, root = sys.argv[1:]
if any(c in root for c in '\n\r%"'): raise SystemExit('Unsupported install path.')
Path(path).write_text('[Unit]\nDescription=igor.computer server\nAfter=network-online.target\n\n[Service]\nExecStart=/bin/bash "'+root+'/scripts/run-service.sh"\nEnvironment="PATH='+root+'/bin:/usr/local/bin:/usr/bin:/bin"\nRestart=on-failure\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n')
PY
  systemctl --user daemon-reload
  systemctl --user enable --now igor-computer.service
fi
printf 'igor.computer server installed. Viewer can quit independently.\n'
printf 'CLI: %s/bin/igor-computer (add it to PATH, or symlink it into ~/.local/bin).\n' "$server_dir"
