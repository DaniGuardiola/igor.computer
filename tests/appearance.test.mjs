import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Appearance, AppliedAppearance, appearanceValue } from '../src/appearance.mjs';

test('system follows host, explicit modes override it, invalid settings fail', () => {
  assert.equal(appearanceValue().dark, false);
  assert.equal(appearanceValue('system', true).dark, true);
  assert.equal(appearanceValue('light', true).dark, false);
  assert.equal(appearanceValue('dark', false).dark, true);
  assert.throws(() => appearanceValue('auto', false));
  assert.throws(() => appearanceValue('system', 'dark'));
});

test('applied appearance follows the latest saved selection and avoids repeated application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'igor-appearance-'));
  try {
    const calls = [];
    const appearance = new Appearance(root);
    const applied = new AppliedAppearance(appearance, async dark => calls.push(dark));
    await appearance.set('dark', false);
    await applied.ensure();
    await applied.ensure();
    assert.deepEqual(calls, [true]);
    const restored = new Appearance(root);
    await restored.load();
    assert.equal(restored.value.mode, 'dark');
    await new AppliedAppearance(restored, async dark => calls.push(dark)).ensure();
    assert.deepEqual(calls, [true, true]);
    applied.reset();
    await applied.ensure();
    assert.deepEqual(calls, [true, true, true]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed application keeps the saved mode and later retries succeed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'igor-appearance-'));
  try {
    let fail = true;
    const appearance = new Appearance(root);
    const applied = new AppliedAppearance(appearance, async () => { if (fail) throw Error('theme unavailable'); });
    await appearance.set('dark', false);
    await assert.rejects(applied.ensure());
    assert.equal(appearance.value.dark, true);
    fail = false;
    await applied.ensure();
    assert.equal(applied.appliedDark, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
