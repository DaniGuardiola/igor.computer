import test from 'node:test';
import assert from 'node:assert/strict';
import { Watch, activity } from '../src/watch.mjs';

test('activity strips secrets and exposes only safe keys and coordinates', () => {
  assert.deepEqual(activity('fill', { uid: '1_2', value: 'password', x: 4, y: 6 }), { kind: 'typing', x: 4, y: 6 });
  assert.deepEqual(activity('computer_ui_type_text', { text: 'secret' }), { kind: 'typing' });
  assert.deepEqual(activity('press_key', { key: 'password' }), { kind: 'shortcut' });
  assert.deepEqual(activity('press_key', { key: 'Control+L' }), { kind: 'shortcut', key: 'Control+L' });
  assert.deepEqual(activity('press_key', { key: 'Control+password' }), { kind: 'shortcut' });
  assert.equal(activity('evaluate_script', { function: 'secret' }), null);
});

const state = { generation: 'a', workspaces: [{ name: 'ivo', desktop: 2 }, { name: 'doc', desktop: 3 }], windows: [
  { id: '0x1', title: 'Page A - Chromium', app: 'Chromium', desktop: 2 },
  { id: '0x2', title: 'Page B - Chromium', app: 'Chromium', desktop: 3 },
] };
test('lookup retains browser window identity after navigation and never activates targets', async () => {
  const watch = new Watch(); const calls = []; let renamed = false;
  watch.call = async (method, params) => {
    calls.push(method);
    if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'a', title: renamed ? 'New title' : 'Page A' }, { type: 'page', targetId: 'b', title: 'Page B' }] };
    if (method === 'Browser.getWindowForTarget') return { windowId: params.targetId === 'a' ? 10 : 20 };
    if (method === 'Target.attachToTarget') return { sessionId: params.targetId };
    if (method === 'Page.captureScreenshot') return { data: 'frame' };
    if (method === 'Runtime.evaluate') return { result: { value: { width: 100, height: 80 } } };
    return {};
  };
  assert.equal((await watch.target(state, 'ivo')).window.id, '0x1');
  renamed = true;
  assert.equal((await watch.target(state, 'ivo')).targetId, 'a');
  assert.ok(!calls.includes('Page.bringToFront'));
  assert.equal(await watch.target(state, 'ivo', '0x2'), null);
  assert.equal(await watch.target({ ...state, windows: [] }, 'ivo'), null);
});
test('ambiguous nonempty windows fail closed instead of showing another workspace', async () => {
  const watch = new Watch();
  watch.call = async (method, params) => method === 'Target.getTargets' ? { targetInfos: ['a','b'].map(targetId => ({ targetId, type: 'page', title: 'Page A', url: 'https://example.com' })) } : { windowId: params.targetId };
  await assert.rejects(watch.target(state, 'ivo'), /ambiguous/);
});
