import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { stateDir, origin } from '../src/config.mjs';
const token = (await readFile(join(stateDir, 'token'), 'utf8')).trim();
const clients = [], pages = [];
async function tool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result)); return result;
}
try {
  for (const name of ['verification-a', 'verification-b']) {
    const client = new Client({ name, version: '1' }); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Igor-Workspace': name } } }));
    const url = 'http://127.0.0.1:19080/?client=' + name;
    const page = await tool(client, 'new_page', { url, background: true });
    const pageId = Number(page.content[0].text.match(/(\d+):.*\[selected\]/)?.[1]);
    assert.ok(pageId); pages.push(pageId);
  }
  for (let i = 0; i < clients.length; i++) {
    const listing = await tool(clients[i], 'list_pages', {});
    assert.equal(Number(listing.content[0].text.match(/(\d+):.*\[selected\]/)?.[1]), pages[i]);
    const value = await tool(clients[i], 'evaluate_script', { pageId: pages[i], function: '() => location.href' });
    assert.match(JSON.stringify(value), new RegExp('verification-' + (i === 0 ? 'a' : 'b')));
  }
  const first = await tool(clients[0], 'evaluate_script', { pageId: pages[0], function: "() => { document.cookie='igor_vm_clients=shared; Max-Age=3600; SameSite=Lax'; return true; }" });
  const second = await tool(clients[1], 'evaluate_script', { pageId: pages[1], function: '() => document.cookie' });
  assert.match(JSON.stringify(second), /igor_vm_clients=shared/);
  console.log('PASS: independent DevTools page selection, same browser cookies across agent clients.');
} finally {
  for (let i = 0; i < clients.length; i++) { if (pages[i]) await tool(clients[i], 'close_page', { pageId: pages[i] }).catch(() => {}); await clients[i].close(); }
}
