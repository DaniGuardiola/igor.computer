import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerUse, desktopTools, desktopRequest, scopedDesktopState, scopedSemanticRequest } from '../src/computer-use.mjs';

test('desktop catalog stays distinct from browser tools and excludes setup/shell', () => {
  const schema = { type: 'object' };
  const tools = desktopTools(['get_app_state', 'perform_action', 'run_shell', 'setup_accessibility', 'new_page'].map(name => ({ name, inputSchema: schema })));
  assert.deepEqual(tools.map(tool => tool.name), ['computer_ui_get_app_state', 'computer_ui_perform_action']);
  assert.equal(tools[0].inputSchema, schema);
});

test('desktop snapshots use separate clients per workspace and reset after guest recreation', async () => {
  let connections = 0, closed = 0;
  const calls = [];
  const backend = new ComputerUse(async workspace => {
    connections++;
    return { close: async () => { closed++; }, callTool: async request => { calls.push({ workspace, request }); return { content: [{ type: 'image', mimeType: 'image/png', data: 'test-image' }] }; } };
  });
  const request = { name: 'computer_ui_get_app_state', arguments: { window_id: '0x1' } };
  assert.equal((await backend.call('doc', 'g1', request)).content[0].type, 'image');
  await backend.call('doc', 'g1', request);
  await backend.call('nora', 'g1', request);
  assert.equal(connections, 2);
  await backend.call('doc', 'g2', request);
  assert.equal(connections, 3);
  assert.equal(closed, 1);
  assert.equal(calls[0].request.name, 'get_app_state');
  await assert.rejects(backend.call('doc', 'g2', { name: 'computer_ui_run_shell' }), /Unknown desktop tool/);
  await backend.close();
  assert.equal(closed, 3);
});

test('the MCP gateway routes desktop tools independently and preserves native image output', async () => {
  const { createGateway } = await import('../src/mcp-server.mjs');
  const calls = [];
  const result = { content: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }] };
  const tools = [{ name: 'computer_ui_get_app_state', inputSchema: { type: 'object' } }, { name: 'new_page', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }];
  const gateway = createGateway(tools, async (path, args) => { calls.push({ path, args }); return result; });
  const rpc = async (id, method, params) => {
    const response = await gateway.handle(new Request('http://igor.computer/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }));
    return JSON.parse(/data: (.*)/.exec(await response.text())[1]).result;
  };
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok((await rpc(2, 'tools/list', {})).tools.some(tool => tool.name === 'browser_wait_human'));
  assert.deepEqual(await rpc(3, 'tools/call', { name: 'computer_ui_get_app_state', arguments: {} }), result);
  assert.equal(calls.at(-1).path, '/computer-use');
  await rpc(4, 'tools/call', { name: 'new_page', arguments: { url: 'about:blank' } });
  assert.equal(calls.at(-1).path, '/call');
  assert.equal((await rpc(5, 'tools/call', { name: 'new_page', arguments: {} })).isError, true);
  assert.equal(calls.length, 2);
});


test('desktop window targeting stays in the caller workspace', () => {
  const state = { workspaces: [{ name: 'doc', desktop: 4 }], windows: [{ id: '0x01', desktop: 0, active: false }, { id: '0x02', desktop: 4, active: true }] };
  const schema = { properties: { window_id: {} } };
  const request = { name: 'computer_ui_get_app_state', arguments: { include_screenshot: false } };
  assert.equal(desktopRequest(request, schema, state, 'doc').arguments.window_id, 2);
  assert.equal(request.arguments.window_id, undefined);
  assert.throws(() => desktopRequest({ ...request, arguments: { window_id: 1 } }, schema, state, 'doc'), /not in your workspace/);
  assert.throws(() => desktopRequest(request, schema, { ...state, windows: [] }, 'doc'), /No open application/);
});


test('shared application tree and selectors stay scoped to the target window', () => {
  const snapshot = scopedDesktopState({ window_context: { title: 'host own window' }, accessibility_tree: [
    { index: 0, depth: 0, role: 'application' },
    { index: 1, parent_index: 0, depth: 1, role: 'frame', name: 'other window' },
    { index: 2, parent_index: 1, depth: 2, role: 'button', name: 'Back' },
    { index: 3, parent_index: 0, depth: 1, role: 'frame', name: 'own window', states: ['active'] },
    { index: 4, parent_index: 3, depth: 2, role: 'button', name: 'Back' },
  ] });
  assert.deepEqual(snapshot.accessibility_tree.map(node => node.index), [0, 3, 4]);
  const request = scopedSemanticRequest({ name: 'perform_action', arguments: { name: 'Back' } }, snapshot);
  assert.deepEqual(request.arguments, { element_index: 4 });
  assert.throws(() => scopedSemanticRequest({ name: 'perform_action', arguments: { element_index: 2 } }, snapshot), /missing or ambiguous/);
});

test('backend reports unsupported semantic actions as MCP errors', async () => {
  const backend = new ComputerUse(async () => ({ close: async () => {}, callTool: async () => ({ content: [{ type: 'text', text: '{"ok":false,"message":"unsupported"}' }] }) }));
  try { assert.equal((await backend.call('doc', 'g1', { name: 'computer_ui_type_text', arguments: { text: 'test' } })).isError, true); }
  finally { await backend.close(); }
});
