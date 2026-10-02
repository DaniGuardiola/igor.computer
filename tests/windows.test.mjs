import test from 'node:test';
import assert from 'node:assert/strict';
import { windowCommand } from '../src/windows.mjs';
const generation = '550e8400-e29b-41d4-a716-446655440000';

test('window bridge accepts only fixed actions and validated X11 ids and generations', () => {
  assert.throws(() => windowCommand('exec'), /Unknown/);
  assert.throws(() => windowCommand('close', { id: '0x12; rm', generation }), /Invalid/);
  assert.throws(() => windowCommand('restore', {}), /Refresh/);
  assert.deepEqual(windowCommand('focus', { id: '0x00001234', generation }).slice(-3), ['focus', '0x00001234', generation]);
  assert.deepEqual(windowCommand('restore', { generation }).slice(-3), ['restore', '', generation]);
});
