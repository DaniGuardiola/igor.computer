// Verify the installed service using a disposable tab in the QA workspace.
// No agent conversation is reset and no pre-existing tab is closed.
import WebSocket from 'ws';
import { readFile } from 'node:fs/promises';
import { stateDir, origin } from '../src/config.mjs';
const token = (await readFile(stateDir + '/token', 'utf8')).trim();
async function rpc(path, args, workspace = 'verification') {
  const response = await fetch(origin + path, { method: args === undefined ? 'GET' : 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Igor-Workspace': workspace,
  }, ...(args === undefined ? {} : { body: JSON.stringify(args) }), signal: AbortSignal.timeout(180000) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}
async function browser(name, args = {}, workspace) {
  const value = await rpc('/call', { name, arguments: args }, workspace);
  if (value.isError) throw new Error(value.content?.find(item => item.type === 'text')?.text);
  return value;
}
const text = value => value.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
let pid, pageId;
const original = await rpc('/status');
if (original.mode !== 'agent' || original.busy || original.runtime.activeTurns) throw new Error('Computer is in use. Finish takeover or the active turn before testing.');
const fixture = '<!doctype html><title>igor watch verification</title><style>body{background:#171d29;color:#edf3ff;font:20px system-ui;padding:80px}button,input{font:inherit;padding:20px;border-radius:14px;border:0;margin:16px;background:#749ffc;color:#101828}</style><h1>live workspace</h1><p>agents keep working while you watch.</p><button onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1">watch verification button</button><input aria-label="watch verification input"><p id="clock"></p><script>setInterval(()=>document.querySelector("#clock").textContent="live · "+new Date().toLocaleTimeString(),400)</script>';
try {
  const command = `python3 - <<'PY'\nimport pathlib,subprocess\np=pathlib.Path('/tmp/igor-watch-fixture');p.mkdir(exist_ok=True);(p/'index.html').write_text(${JSON.stringify(fixture)})\nprint(subprocess.Popen(['python3','-m','http.server','19083','--bind','127.0.0.1','--directory',str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)\nPY`;
  const execution = await rpc('/computer', { name: 'computer_exec', arguments: { command } });
  pid = Number(execution.stdout.trim());
  const opened = await browser('new_page', { url: 'http://127.0.0.1:19083/' });
  pageId = Number(text(opened).match(/^(\d+):.*\[selected\]/m)?.[1]);
  if (!Number.isInteger(pageId)) throw new Error('Missing fixture page.');
  await rpc('/watch', { name: 'verification' });
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/vnc/websockify', { headers: { Authorization: 'Bearer ' + token } });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Watch input rejection timed out.')); }, 3000);
    socket.on('open', () => { clearTimeout(timer); socket.close(); reject(new Error('Watch mode accepted desktop input.')); });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); resolve(); });
  });
  const before = await rpc('/watch-frame');
  if (!before.data || before.width !== 1440 || before.height !== 1000 || before.profile.name !== 'verification') throw new Error('Missing own workspace preview.');
  const snapshot = await browser('take_snapshot', { pageId });
  const uid = text(snapshot).match(/uid=(\S+) button "watch verification button"/)?.[1];
  if (!uid) throw new Error('Fixture button not found.');
  await browser('click', { pageId, uid });
  const hint = await rpc('/watch-frame');
  if (hint.activity?.kind !== 'click' || !Number.isFinite(hint.activity.x)) throw new Error('Target cursor hint missing.');
  const clicked = await browser('evaluate_script', { pageId, function: '() => document.querySelector("button").dataset.clicks' });
  if (!text(clicked).includes('"1"')) throw new Error('Agent click did not run while watching.');
  console.log('PASS live preview and measured cursor: browser works while watched');
  await rpc('/workspaces', { action: 'select', name: 'shared' });
  let finished = false;
  const inFlight = rpc('/computer', { name: 'computer_exec', arguments: { command: 'sleep 0.5; printf drained' } }, 'shared').then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 150));
  await rpc('/take-control', { name: 'shared' });
  if (!finished) throw new Error('Takeover interrupted the active command.');
  await inFlight;
  const during = await rpc('/status');
  if (during.humanWorkspace !== 'shared') throw new Error('Wrong takeover workspace.');
  await rpc('/computer', { name: 'computer_exec', arguments: { command: 'printf other-workspace-running' } });
  await browser('evaluate_script', { pageId, function: '() => document.title' });
  let blocked = false;
  try { await rpc('/computer', { name: 'computer_exec', arguments: { command: 'true' } }, 'shared'); } catch (error) { blocked = /paused/.test(error.message); }
  if (!blocked) throw new Error('Controlled workspace still accepts automation.');
  blocked = false;
  try { await rpc('/computer', { name: 'computer_input', arguments: { kind: 'key', key: 'Return' } }); } catch (error) { blocked = /paused/.test(error.message); }
  if (!blocked) throw new Error('Physical input was not blocked during human control.');
  console.log('PASS scoped takeover: own commands blocked, other browser/shell continue, physical input waits');
  await rpc('/release-control', {});
  const released = await rpc('/status');
  if (!released.viewerOpen || released.mode !== 'agent') throw new Error('Done did not return to watching.');
  await rpc('/workspaces', { action: 'select', name: 'verification' });
  await rpc('/take-control', {});
  await rpc('/workspaces', { action: 'select', name: 'shared' });
  if ((await rpc('/status')).mode !== 'agent') throw new Error('Workspace switching retained takeover.');
  console.log('PASS done and workspace switching return to read-only watch');
} finally {
  const status = await rpc('/status');
  if (status.mode === 'human') await rpc('/release-control', {});
  if (pageId !== undefined) await browser('close_page', { pageId }).catch(() => {});
  if (pid) await rpc('/computer', { name: 'computer_exec', arguments: { command: 'kill ' + pid + '; rm -rf /tmp/igor-watch-fixture' } }).catch(() => {});
  if (original.viewerOpen) await rpc('/watch', { name: original.viewedWorkspace });
  else await rpc('/close-viewer', {});
}
