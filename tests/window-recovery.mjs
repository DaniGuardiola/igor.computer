// Integration check against a disposable container/profile; never the user's browser.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeEnv, vmDir, vmName } from '../src/config.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const exec = promisify(execFile);
const name = 'igor-browser-window-test-' + randomUUID().slice(0, 8);
const volume = name + '-profile';
const docker = async (...args) => (await exec('docker', args, { timeout: 60000, env: runtimeEnv })).stdout.trim();
const bridge = async (action = 'list', id = '', generation = '') => JSON.parse(await docker('exec', name, 'python3', '/opt/igor-browser/windows.py', action, ...(action === 'list' ? [] : [id, generation])));
async function waitFor(fn) { for (let n = 0; n < 100; n++) { try { const result = await fn(); if (result) return result; } catch {} await delay(200); } throw new Error('Recovery timed out'); }
async function cdp() {
  const version = await (await fetch('http://127.0.0.1:18432/json/version')).json();
  const url = new URL(version.webSocketDebuggerUrl); url.host = '127.0.0.1:18432';
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0; const pending = new Map();
  ws.on('message', data => { const m = JSON.parse(data); if (pending.has(m.id)) { const [r, j] = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(m.error.message)) : r(m.result); } });
  return { close: () => ws.close(), send: (method, params = {}, sessionId) => new Promise((r, j) => { pending.set(++id, [r, j]); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }) };
}
const processIds = () => docker('exec', name, 'python3', '-c', "import glob,json; names=['Xvfb','openbox','x11vnc']; print(json.dumps(sorted((p.split('/')[2],open(p).read().strip()) for p in glob.glob('/proc/[0-9]*/comm') if open(p).read().strip() in names)))");
let client, connection, vnc;
const tunnel = action => exec('ssh', ['-F', join(vmDir, 'ssh.config'), '-O', action, '-L', '127.0.0.1:18432:127.0.0.1:18432', '-L', '127.0.0.1:18433:127.0.0.1:18433', 'lima-' + vmName]);
try {
  await tunnel('forward');
  const backgroundStart = process.argv.includes('--background-start');
  await docker('run', '-d', '--name', name, ...(backgroundStart ? ['--entrypoint', 'python3'] : []), '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--security-opt', 'seccomp=' + process.cwd() + '/container/seccomp.json', '--shm-size', '512m', '--memory', '2g', '--cpus', '2', '-p', '127.0.0.1:18432:9222', '-p', '127.0.0.1:18433:6080', '-v', volume + ':/profile', 'igor-vm:0.2.0', ...(backgroundStart ? ['-c', `exec(open('/opt/igor-browser/supervisor.py').read().replace("browser_args = ['chromium'", "browser_args = ['chromium', '--no-startup-window'"))`] : []));
  let initialGeneration;
  if (backgroundStart) {
    await waitFor(async () => (await fetch('http://127.0.0.1:18432/json/version')).ok);
    const initial = await bridge();
    assert.equal(initial.windows.length, 0);
    initialGeneration = initial.generation;
  }
  await waitFor(async () => (await bridge()).windows.length);
  if (backgroundStart) {
    assert.equal((await bridge()).generation, initialGeneration);
    console.log('PASS: empty background browser opens a usable window without restarting Chromium');
  }
  await docker('exec', name, 'xprop', '-root', '-remove', '_NET_ACTIVE_WINDOW');
  assert.equal((await bridge()).windows.length, 1);
  console.log('PASS: window listing works before the window manager sets an active window');
  const processes = await processIds();
  connection = await cdp();
  client = new Client({ name: 'window-recovery-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js', '--browser-url=http://127.0.0.1:18432', '--no-usage-statistics', '--no-performance-crux'], stderr: 'ignore' }));
  const beforePages = await client.callTool({ name: 'list_pages', arguments: {} });
  const oldPageId = Number(beforePages.content.filter(x => x.type === 'text').map(x => x.text).join('\n').match(/(\d+):/)[1]);
  const target = await connection.send('Target.createTarget', { url: 'data:text/html,<title>second window</title>', newWindow: true });
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await connection.send('Network.setCookie', { name: 'recovery-test', value: 'saved', url: 'https://recovery.invalid', expires: Date.now() / 1000 + 3600 }, sessionId);
  const state = await waitFor(async () => { const s = await bridge(); return s.windows.length >= 2 && s; });
  await waitFor(async () => (await bridge()).windows.some(w => w.title === 'second window - Chromium'));
  const { windowId } = await connection.send('Browser.getWindowForTarget', { targetId: target.targetId });
  await connection.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await connection.send('Browser.setWindowBounds', { windowId, bounds: { left: 200, top: 200, width: 600, height: 500 } });
  await connection.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  const targetWindow = (await bridge()).windows.find(window => window.title === 'second window - Chromium');
  await docker('exec', name, 'wmctrl', '-n', '2');
  await docker('exec', name, 'wmctrl', '-ir', targetWindow.id, '-t', '1');
  await bridge('restore', '', state.generation);
  assert.equal((await bridge()).windows.find(window => window.id === targetWindow.id).desktop, 1);
  await delay(300);
  assert.equal((await connection.send('Browser.getWindowBounds', { windowId })).bounds.windowState, 'maximized');
  await bridge('focus', state.windows[0].id, state.generation);
  await delay(200);
  assert.equal((await bridge()).windows.find(w => w.id === state.windows[0].id).active, true);
  console.log('PASS: window listing, focus, and restore recover a resized/minimized window');
  const displaySecret = await docker('exec', name, 'cat', '/tmp/igor-vm-display-auth');
  vnc = new WebSocket('ws://127.0.0.1:18433/websockify', { headers: { Authorization: 'Basic ' + Buffer.from(displaySecret).toString('base64') } });
  await new Promise((r, j) => { vnc.once('message', data => { assert.match(data.toString(), /^RFB/); r(); }); vnc.once('error', j); });
  connection.close();
  for (const w of (await bridge()).windows) await bridge('close', w.id, state.generation);
  const recovered = await waitFor(async () => { const s = await bridge(); return s.windows.length && (s.generation !== state.generation || s.windows.every(w => !state.windows.some(old => old.id === w.id))) && s; });
  assert.equal(await processIds(), processes);
  assert.equal(vnc.readyState, WebSocket.OPEN);
  assert.equal(await docker('inspect', '--format', '{{.RestartCount}}', name), '0');
  if (recovered.generation !== state.generation) await assert.rejects(bridge('close', recovered.windows[0].id, state.generation));
  else await assert.rejects(bridge('close', state.windows[0].id, state.generation));
  const afterPages = await waitFor(async () => { const r = await client.callTool({ name: 'list_pages', arguments: {} }); return !r.isError && r; });
  assert.match(afterPages.content.filter(x => x.type === 'text').map(x => x.text).join('\n'), /about:blank/);
  assert.equal((await client.callTool({ name: 'select_page', arguments: { pageId: oldPageId } })).isError, true);
  for (let n = 0; n < 6; n++) {
    const current = await bridge();
    for (const w of current.windows) await bridge('close', w.id, current.generation);
    await waitFor(async () => { const s = await bridge(); return s.windows.length && (s.generation !== current.generation || s.windows.every(w => !current.windows.some(old => old.id === w.id))); });
  }
  assert.equal(await processIds(), processes);
  assert.equal(vnc.readyState, WebSocket.OPEN);
  assert.equal(await docker('inspect', '--format', '{{.RestartCount}}', name), '0');
  console.log('PASS: repeated deliberate last-window closes never trigger the crash restart limit');
  connection = await cdp();
  const pages = await connection.send('Target.getTargets');
  const page = pages.targetInfos.find(t => t.type === 'page');
  const attached = await connection.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const cookies = await connection.send('Network.getCookies', { urls: ['https://recovery.invalid'] }, attached.sessionId);
  assert.equal(cookies.cookies.find(c => c.name === 'recovery-test')?.value, 'saved');
  console.log('PASS: last close recovers the browser; VNC survives, cookies persist, same MCP session works, stale ids fail safely');
} finally {
  connection?.close(); vnc?.close(); await client?.close();
  await docker('rm', '-f', name).catch(() => {});
  await docker('volume', 'rm', volume).catch(() => {});
  await tunnel('cancel').catch(() => {});
}
