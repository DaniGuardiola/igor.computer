// Run only against an idle, independently installed macOS server.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir, origin } from '../src/config.mjs';
const exec = promisify(execFile);
assert.equal(process.platform, 'darwin');
const token = (await readFile(join(stateDir, 'token'), 'utf8')).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function rpc(path, args, allowError = false) {
  const response = await fetch(origin + path, { headers, method: args === undefined ? 'GET' : 'POST', ...(args === undefined ? {} : { body: JSON.stringify(args) }), signal: AbortSignal.timeout(60000) });
  const value = await response.json(); if (!allowError) assert.equal(response.status, 200, value.error); return { code: response.status, value };
}
const call = (name, parameters = {}, allowError = false) => rpc('/computer', { name, arguments: parameters }, allowError);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
  for (let i = 0; i < 120; i++) {
    try { const { value } = await rpc('/status'); if (value.runtime.state === 'awake') return value; } catch {}
    await delay(250);
  }
  throw new Error('Server did not recover.');
}
const initial = (await rpc('/status')).value;
assert.equal(initial.mode, 'agent'); assert.equal(initial.busy, false); assert.equal(initial.runtime.activeTurns, 0);
const turnId = 'restart-verification';
await call('computer_begin_turn', { turnId });
await exec('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/ai.igor.vm.server`]);
const leased = await ready();
assert.ok(leased.runtime.turnIds.includes(turnId));
assert.equal((await call('computer_sleep', {}, true)).code, 409);
await call('computer_end_turn', { turnId });
const pending = call('computer_exec', { command: 'sleep 20; printf verification-complete', timeoutSeconds: 30 }).catch(() => null);
for (let i = 0; i < 100; i++) { if ((await rpc('/status')).value.busy) break; await delay(50); }
// Wait until the guest command itself has launched, beyond the host busy flag.
await delay(500);
await exec('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/ai.igor.vm.server`]);
const interrupted = await ready();
assert.equal(interrupted.mode, 'paused'); assert.equal(interrupted.automationPaused, true);
const takeover = await rpc('/take-control', {}, true);
assert.equal(takeover.code, 409); assert.match(takeover.value.error, /interrupted computer command/);
await pending;
await delay(21000);
await rpc('/take-control', {}); await rpc('/resume', {});
assert.equal((await rpc('/status')).value.mode, 'agent');
console.log('PASS: turn leases survive actual server restart; interrupted commands restore paused ownership and block human takeover until drained.');
