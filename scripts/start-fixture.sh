#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/vm-env.sh
# Await the server's startup/image replacement before addressing its container.
node --input-type=module - <<'JS'
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {stateDir,origin} from './src/config.mjs';
const token=(await readFile(join(stateDir,'token'),'utf8')).trim();
let response;
for(let attempt=0;attempt<120;attempt++) {
  try {
    response=await fetch(origin+'/computer',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'computer_wake',arguments:{}}),signal:AbortSignal.timeout(180000)});
    break;
  } catch(error) {
    if(error.cause?.code!=='ECONNREFUSED') throw error;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}
if(!response) throw new Error('Server did not start for verification.');
const value=await response.json();
if(!response.ok) throw new Error(value.error);
if(value.state!=='awake') throw new Error('Computer is not ready for verification.');
JS
docker exec igor-vm mkdir -p /tmp/igor-browser-fixture
docker cp tests/fixture.html igor-vm:/tmp/igor-browser-fixture/index.html
if ! docker exec igor-vm pgrep -f '^python3 -m http.server 19080 ' >/dev/null; then
  docker exec -d igor-vm python3 -m http.server 19080 --bind 127.0.0.1 --directory /tmp/igor-browser-fixture
fi
