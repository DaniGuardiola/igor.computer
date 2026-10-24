import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const token = (await readFile(homedir() + '/Library/Application Support/igor.computer/token', 'utf8')).trim();
const origin = 'http://127.0.0.1:18420';
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
async function rpc(path, args) {
  const response = await fetch(origin + path, { method: args === undefined ? 'GET' : 'POST', headers,
    ...(args === undefined ? {} : { body: JSON.stringify(args) }) });
  const value = await response.json();
  assert.equal(response.status, 200, value.error);
  return value;
}
assert.equal((await fetch(origin + '/status')).status, 401);
assert.equal((await fetch(origin + '/status', { headers: { ...headers, Origin: 'http://other.example' } })).status, 403);
const status = await rpc('/status');
if (status.mode !== 'agent') {
  await rpc('/take-control', {});
  await rpc('/resume', {});
}
const client = new Client({ name: 'igor-computer-live-check', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'] }));
try {
  const tools = (await client.listTools()).tools;
  for (const name of ['new_page', 'take_snapshot', 'browser_request_human', 'browser_wait_human']) {
    assert.ok(tools.some(tool => tool.name === name), name);
  }
  const page = await client.callTool({ name: 'new_page', arguments: { url: 'http://127.0.0.1:19080/', background: true } });
  assert.ok(!page.isError, JSON.stringify(page));
  const text = page.content.find(c => c.type === 'text').text;
  const pageId = Number(text.match(/(\d+):.*\[selected\]/)?.[1]);
  assert.ok(pageId);
  async function evaluate(fn) {
    const value = await client.callTool({ name: 'evaluate_script', arguments: { pageId, function: fn } });
    assert.ok(!value.isError, JSON.stringify(value));
    return JSON.stringify(value);
  }
  await evaluate("() => { window.liveMarker='same-page-survived'; localStorage.setItem('igor-computer-smoke','profile-survived'); document.cookie='igor_computer_smoke=profile-survived; Max-Age=3600; SameSite=Lax'; return document.title; }");
  const handoff = await client.callTool({ name: 'browser_request_human', arguments: { pageId, message: 'Try typing in the browser verification page.' } });
  assert.ok(!handoff.isError, JSON.stringify(handoff));
  const requestId = JSON.parse(handoff.content[0].text).request.id;
  // Asking for help never blocks the agent.
  assert.ok(!(await client.callTool({ name: 'take_snapshot', arguments: { pageId } })).isError);
  await rpc('/take-control', {});
  assert.ok((await client.callTool({ name: 'evaluate_script', arguments: { pageId, function: '() => document.title' } })).isError);
  await rpc('/resume', {});
  const waited = await client.callTool({ name: 'browser_wait_human', arguments: { requestId, timeoutSeconds: 1 } });
  assert.equal(JSON.parse(waited.content[0].text).outcome, 'continued');
  assert.match(await evaluate('() => window.liveMarker'), /same-page-survived/);
  const dismissed = JSON.parse((await client.callTool({ name: 'browser_request_human', arguments: { pageId, message: 'Dismissal verification.' } })).content[0].text).request.id;
  await rpc('/dismiss-request', { id: dismissed });
  assert.equal(JSON.parse((await client.callTool({ name: 'browser_wait_human', arguments: { requestId: dismissed, timeoutSeconds: 1 } })).content[0].text).outcome, 'dismissed');
  assert.ok(!(await client.callTool({ name: 'take_snapshot', arguments: { pageId } })).isError);
  const withdrawn = JSON.parse((await client.callTool({ name: 'browser_request_human', arguments: { message: 'Withdrawal verification.' } })).content[0].text).request.id;
  assert.ok(!(await client.callTool({ name: 'browser_withdraw_human', arguments: { requestId: withdrawn } })).isError);
  console.log('PASS: MCP discovery, real rendering, live state, human lock, resume, non-blocking help requests, HTTP authorization.');
  console.log('Fixture page ID:', pageId);
} finally { await client.close(); }
