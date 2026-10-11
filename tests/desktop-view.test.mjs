import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopView } from '../src/desktop-view.mjs';

test('desktop view retains only the requested workspace frame during shared input', async () => {
  let result = { data: 'own-desktop', width: 1440, height: 1000 };
  const calls = [];
  const view = new DesktopView(async args => { calls.push(args); return { stdout: JSON.stringify(result) }; });
  const state = { generation: 'one', workspaces: [{ name: 'ivo', desktop: 2 }, { name: 'doc', desktop: 3 }] };
  assert.equal((await view.frame(state, 'ivo')).data, 'own-desktop');
  assert.equal(calls[0].at(-1), '2');
  assert.ok(calls[0][2].includes('if desktop()!=wanted'));
  assert.ok(!calls[0][2].includes('workspace_select'));
  result = { data: 'stale-desktop', width: 1440, height: 1000 };
  assert.equal((await view.frame(state, 'ivo', () => false)).data, 'own-desktop');
  result = { waiting: true };
  assert.equal((await view.frame(state, 'ivo')).data, 'own-desktop');
  assert.deepEqual(await view.frame(state, 'doc'), { waiting: true });
  assert.deepEqual(await view.frame({ ...state, generation: 'two' }, 'ivo'), { waiting: true });
  await assert.rejects(view.frame(state, 'missing'), /Unknown workspace/);
});
