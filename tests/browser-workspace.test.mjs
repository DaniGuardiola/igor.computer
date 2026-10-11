import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspaces, pageIds, recoveredRequest } from '../src/browser-workspace.mjs';

test('recovery and new pages stay in the caller workspace without desktop focus', async () => {
  let opened = false, count = 0;
  const actions = [];
  const url = 'data:text/html,<title>unique</title>';
  const state = () => ({ generation: 'g', workspaces: [{ name: 'agent', desktop: 2 }], windows: [{ id: 'user-window', desktop: 0, app: 'Chromium' }, ...(opened ? [{ id: 'own', desktop: 2, app: 'Chromium' }] : [])] });
  const helper = new BrowserWorkspaces(async (action, args) => { actions.push([action, args]); return state(); }, () => assert.fail('Must not focus desktop'), undefined,
    async name => { assert.equal(name, 'agent'); opened = true; count++; return url; });
  const calls = [];
  const client = { async callTool(request) { calls.push(request); return { content: [{ type: 'text', text: '1: user\n7: unique (' + url + ')' }] }; } };
  const recovery = await helper.ensure('agent', 'nora', client, 'navigate_page');
  assert.equal(recovery.pageId, 7);
  assert.deepEqual(calls.find(call => call.name === 'select_page').arguments, { pageId: 7, bringToFront: false });
  await helper.ensure('agent', 'nora', client, 'evaluate_script');
  assert.equal(count, 1);
  await helper.ensure('agent', 'nora', client, 'new_page');
  assert.equal(count, 2);
  opened = false;
  await helper.ensure('agent', 'nora', client, 'list_pages');
  assert.equal(count, 3);
  assert.equal(actions.some(([action]) => /select|open_browser/.test(action)), false);
});

test('an unambiguous existing page is selected without creating or focusing windows', async () => {
  const state = { generation: 'g', workspaces: [{ name: 'agent', desktop: 1 }], windows: [{ id: 'own', desktop: 1, app: 'Chromium' }] };
  const helper = new BrowserWorkspaces(async () => state, () => assert.fail(), async () => 7, () => assert.fail());
  const calls = [];
  const client = { async callTool(request) { calls.push(request); return {}; } };
  await helper.ensure('agent', 'agent', client, 'evaluate_script');
  assert.deepEqual(calls, [{ name: 'select_page', arguments: { pageId: 7, bringToFront: false } }]);
  assert.deepEqual(pageIds({ content: [{ type: 'text', text: '0: about:blank [selected]\n12: https://example.test' }] }), [0, 12]);
});

test('recovery continues stale page commands and consumes the fresh tab for new_page', () => {
  const recovery = { pageId: 7, currentIds: [3, 7] };
  assert.deepEqual(recoveredRequest({ name: 'navigate_page', arguments: { pageId: 1, url: 'https://example.test' } }, recovery).arguments, { pageId: 7, url: 'https://example.test' });
  const existing = { name: 'select_page', arguments: { pageId: 3 } };
  assert.equal(recoveredRequest(existing, recovery), existing);
  assert.deepEqual(recoveredRequest({ name: 'new_page', arguments: { url: 'https://example.test' } }, recovery), { name: 'navigate_page', arguments: { pageId: 7, type: 'url', url: 'https://example.test' } });
  const isolated = { name: 'new_page', arguments: { url: 'about:blank', isolatedContext: 'isolated' } };
  assert.deepEqual(recoveredRequest(isolated, recovery), { name: 'navigate_page', arguments: { pageId: 7, type: 'url', url: 'about:blank' } });
});

test('failed CDP selection removes the fresh bootstrap window', async () => {
  let closed = false;
  const helper = new BrowserWorkspaces(async () => ({ workspaces: [{ name: 'agent', desktop: 1 }], windows: [] }), undefined, undefined,
    async () => ({ url: 'data:text/html,marker', close: async () => { closed = true; } }));
  const client = { async callTool(request) { return request.name === 'list_pages' ? { content: [{ type: 'text', text: '7: data:text/html,marker' }] } : { isError: true }; } };
  await assert.rejects(helper.ensure('agent', 'agent', client, 'new_page'), /Could not select/);
  assert.equal(closed, true);
  assert.equal(helper.prepared.has('agent'), false);
});
