import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { stateDir, origin } from '../src/config.mjs';

const token = (await readFile(join(stateDir, 'token'), 'utf8')).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function rpc(path, args) {
  const response = await fetch(origin + path, { headers, method: args === undefined ? 'GET' : 'POST', ...(args === undefined ? {} : { body: JSON.stringify(args) }) });
  const data = await response.json(); assert.equal(response.status, 200, data.error); return data;
}
const stdio = new Client({ name: 'vm-live-stdio', version: '1' });
const remote = new Client({ name: 'vm-live-http', version: '1' });
let pageId, testWindow;
const turnId = 'verification-' + Date.now();
const pageUrl = 'http://127.0.0.1:19080/?snapshot=' + turnId;
async function tool(client, name, args = {}, allowError = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  if (!allowError) assert.ok(!result.isError, JSON.stringify(result));
  return result;
}
function data(result) { return JSON.parse(result.content[0].text); }
try {
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'] }));
  await remote.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers } }));
  assert.equal((await fetch(origin + '/mcp', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(origin + '/status', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  const discovery = await remote.listTools();
  for (const name of ['new_page', 'computer_exec', 'computer_file', 'computer_input', 'computer_workspace', 'computer_sleep']) assert.ok(discovery.tools.some(tool => tool.name === name));
  const state = await rpc('/status');
  if (state.mode !== 'agent') { await rpc('/take-control', {}); await rpc('/resume', {}); }
  assert.equal(data(await tool(remote, 'computer_exec', { command: 'printf vm-shell-ok' })).stdout, 'vm-shell-ok');
  await tool(stdio, 'computer_file', { operation: 'write', path: 'verification/state.txt', content: 'persistent workspace' });
  assert.equal(Buffer.from(data(await tool(remote, 'computer_file', { operation: 'read', path: 'verification/state.txt' })).content, 'base64').toString(), 'persistent workspace');
  assert.ok(data(await tool(remote, 'computer_file', { operation: 'list', path: '.' })).entries.some(entry => entry.name === 'verification'));
  assert.ok((await tool(remote, 'computer_file', { operation: 'write', path: '../escape', content: 'no' }, true)).isError);
  const page = await tool(stdio, 'new_page', { url: pageUrl, background: false });
  pageId = Number(page.content.find(c => c.type === 'text').text.match(/(\d+):.*\[selected\]/)?.[1]);
  assert.ok(pageId);
  await tool(stdio, 'evaluate_script', { pageId, function: "() => { document.querySelector('#human-input').value='unsaved-snapshot'; window.vmMarker='ram-survived'; document.cookie='igor_vm_live=shared-profile; Max-Age=3600; SameSite=Lax'; return true; }" });
  const workspace = data(await tool(remote, 'computer_workspace', { action: 'create', name: 'verification' }));
  assert.ok(workspace.workspaces.some(w => w.name === 'verification'));
  const before = new Set(workspace.windows.map(w => w.id));
  const created = data(await tool(remote, 'computer_workspace', { action: 'open_browser', name: 'verification', url: 'http://127.0.0.1:19080/' }));
  testWindow = created.windows.find(w => !before.has(w.id));
  assert.ok(testWindow); assert.equal(testWindow.desktop, created.workspaces.find(w => w.name === 'verification').desktop);
  await tool(remote, 'computer_workspace', { action: 'select', name: 'verification' });
  const shot = await tool(remote, 'computer_screenshot');
  assert.equal(shot.content[0].type, 'image');
  const bytes = Buffer.from(shot.content[0].data, 'base64'); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  await writeFile('/tmp/igor-vm-live-desktop.png', bytes);
  // Pixel input and shared cookie check target the test window only.
  await tool(remote, 'computer_input', { kind: 'key', key: 'ctrl+l' });
  await tool(remote, 'computer_input', { kind: 'key', key: 'Escape' });
  await tool(stdio, 'select_page', { pageId, bringToFront: true });
  await tool(stdio, 'computer_begin_turn', { turnId });
  assert.ok((await tool(remote, 'computer_sleep', {}, true)).isError);
  await tool(stdio, 'computer_end_turn', { turnId });
  const sleepStart = Date.now();
  const slept = data(await tool(remote, 'computer_sleep'));
  assert.equal(slept.state, 'sleeping');
  const sleepMs = Date.now() - sleepStart;
  assert.equal((await rpc('/status')).runtime.state, 'sleeping');
  const wakeStart = Date.now();
  await tool(remote, 'computer_wake');
  const pages = await tool(stdio, 'list_pages');
  const line = pages.content[0].text.split('\n').find(line => line.includes(pageUrl));
  pageId = Number(line?.match(/^(\d+):/)?.[1]); assert.ok(pageId, JSON.stringify(pages));
  const value = await tool(stdio, 'evaluate_script', { pageId, function: "() => ({ marker: window.vmMarker, input: document.querySelector('#human-input').value, cookie: document.cookie })" });
  const wakeMs = Date.now() - wakeStart;
  assert.match(JSON.stringify(value), /ram-survived/); assert.match(JSON.stringify(value), /unsaved-snapshot/); assert.match(JSON.stringify(value), /shared-profile/);
  assert.equal(Buffer.from(data(await tool(remote, 'computer_file', { operation: 'read', path: 'verification/state.txt' })).content, 'base64').toString(), 'persistent workspace');
  assert.equal((await fetch('http://127.0.0.1:18423/vnc.html')).status, 401);
  await rpc('/take-control', {});
  const resource = await fetch(origin + '/vnc/core/rfb.js', { headers });
  assert.equal(resource.status, 200); await resource.body?.cancel();
  const display = new WebSocket(origin.replace(/^http/, 'ws') + '/vnc/websockify', { headers });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { display.terminate(); reject(new Error('Display handshake timed out.')); }, 10000);
    display.once('error', error => { clearTimeout(timeout); reject(error); });
    display.once('message', value => { clearTimeout(timeout); try { assert.match(value.toString(), /^RFB/); resolve(); } catch(error) { reject(error); } });
  });
  display.close();
  for (const [name, args] of [['computer_exec', { command: 'true' }], ['computer_input', { kind: 'key', key: 'Return' }], ['take_snapshot', { pageId }]]) assert.ok((await tool(remote, name, args, true)).isError);
  assert.ok((await tool(remote, 'computer_sleep', {}, true)).isError);
  await rpc('/close-viewer', {});
  console.log(JSON.stringify({ passed: ['stdio MCP', 'HTTP MCP', 'auth/origin', 'shell/files', 'file confinement', 'shared profile workspaces', 'desktop screenshot/input', 'turn sleep guard', 'RAM/form/cookie snapshot restore', 'file persistence', 'human ownership gate', 'authenticated display proxy'], sleepMs, wakeMs }));
} finally {
  await rpc('/computer', { name: 'computer_end_turn', arguments: { turnId } }).catch(() => {});
  const state = await rpc('/status').catch(() => null);
  if (state?.mode === 'human') await rpc('/close-viewer', {}).catch(() => {});
  if (testWindow) await tool(remote, 'computer_exec', { command: `wmctrl -ic ${testWindow.id}` }).catch(() => {});
  if (pageId) await tool(stdio, 'close_page', { pageId }).catch(() => {});
  await stdio.close(); await remote.close();
}
