import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspaces, pageIds, recoveredRequest } from '../src/browser-workspace.mjs';

test('closed agent workspace reopens there and selects its new page, preserving other windows', async () => {
  const actions = [];
  let opened = false;
  const state = () => ({ generation: 'generation', workspaces: [{ name: 'agent', desktop: 2 }], windows: [{ id: 'user-window', desktop: 0, app: 'Chromium' }, ...(opened ? [{ id: 'agent-window', desktop: 2, app: 'Chromium' }] : [])] });
  const helper = new BrowserWorkspaces(async (action, args) => { actions.push([action, args]); if (action === 'workspace_open_browser') opened = true; return state(); }, async (...args) => actions.push(args));
  const calls = [];
  const client = { async callTool(request) { calls.push(request); return { content: [{ type: 'text', text: opened ? '1: user\n2: about:blank' : '1: user' }] }; } };
  await helper.ensure('agent', 'nora', client, 'navigate_page');
  assert.deepEqual(actions.find(([action]) => action === 'workspace_open_browser')[1], { name: 'agent', reuse: true });
  assert.deepEqual(calls.find(call => call.name === 'select_page').arguments, { pageId: 2 });
  actions.length = 0;
  await helper.ensure('agent', 'nora', client, 'evaluate_script');
  assert.equal(actions.some(([action]) => action === 'workspace_open_browser'), false);
  opened = false;
  await helper.ensure('agent', 'nora', client, 'list_pages');
  assert.equal(actions.filter(([action]) => action === 'workspace_open_browser').length, 1);
});

test('first connection selects an existing workspace tab by focus without creating another window', async () => {
  const actions = [];
  const state = { generation: 'g', workspaces: [{ name: 'agent', desktop: 1 }], windows: [{ id: 'own', desktop: 1, app: 'Chromium' }] };
  const helper = new BrowserWorkspaces(async action => { actions.push(action); return state; }, async (action, args) => { assert.equal(args.id, 'own'); actions.push(action); });
  const calls = [];
  const client = { async callTool(request) { calls.push(request); return { content: [{ type: 'text', text: request.name === 'list_pages' ? '1: user\n7: own' : JSON.stringify({ igorWorkspaceFocused: request.arguments.pageId === 7 }) }] }; } };
  await helper.ensure('agent', 'agent', client, 'evaluate_script');
  assert.deepEqual(calls.find(call => call.name === 'select_page').arguments, { pageId: 7 });
  assert.equal(actions.includes('workspace_open_browser'), false);
  assert.deepEqual(pageIds({ content: [{ type: 'text', text: '## Pages\n0: about:blank [selected]\n12: https://example.test' }] }), [0, 12]);
});

test('recovery continues stale page commands and consumes the fresh tab for new_page', () => {
  const recovery = { pageId: 7, currentIds: [3, 7] };
  assert.deepEqual(recoveredRequest({ name: 'navigate_page', arguments: { pageId: 1, url: 'https://example.test' } }, recovery).arguments, { pageId: 7, url: 'https://example.test' });
  const existing = { name: 'select_page', arguments: { pageId: 3 } };
  assert.equal(recoveredRequest(existing, recovery), existing);
  assert.deepEqual(recoveredRequest({ name: 'new_page', arguments: { url: 'https://example.test' } }, recovery), { name: 'navigate_page', arguments: { pageId: 7, type: 'url', url: 'https://example.test' } });
  const isolated = { name: 'new_page', arguments: { url: 'about:blank', isolatedContext: 'isolated' } };
  assert.equal(recoveredRequest(isolated, recovery), isolated);
});
