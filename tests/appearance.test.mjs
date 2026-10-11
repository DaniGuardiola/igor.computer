import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Appearance, appearanceValue } from '../src/appearance.mjs';

test('system follows host, explicit modes override it, invalid settings fail', () => {
  assert.equal(appearanceValue().dark, false);
  assert.equal(appearanceValue('system', true).dark, true);
  assert.equal(appearanceValue('light', true).dark, false);
  assert.equal(appearanceValue('dark', false).dark, true);
  assert.throws(() => appearanceValue('auto', false));
  assert.throws(() => appearanceValue('system', 'dark'));
});

test('queued ensure follows latest selection, persists it, and avoids repeated application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'igor-appearance-'));
  try {
    const calls = [];
    const appearance = new Appearance(root, async dark => calls.push(dark));
    const pending = appearance.set('dark', false);
    await appearance.ensure();
    await pending;
    await appearance.ensure();
    assert.deepEqual(calls, [true]);
    const restored = new Appearance(root, async dark => calls.push(dark));
    await restored.load();
    assert.equal(restored.value.mode, 'dark');
    await restored.ensure();
    assert.deepEqual(calls, [true, true]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed application retains saved mode and later retries succeed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'igor-appearance-'));
  try {
    let fail = true;
    const appearance = new Appearance(root, async () => { if (fail) throw Error('theme unavailable'); });
    await assert.rejects(appearance.set('dark', false));
    assert.equal(appearance.value.mode, 'system');
    fail = false;
    await appearance.set('dark', false);
    assert.equal(appearance.value.dark, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
