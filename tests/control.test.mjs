import test from 'node:test';
import assert from 'node:assert/strict';
import { Control } from '../src/control.mjs';

test('human request blocks automation before the viewer opens; completion restores control', async () => {
  const control = new Control();
  const request = control.requestHuman('Sign in to the test site.', 1).request;
  await assert.rejects(control.run(() => assert.fail('Must not run')), /paused/);
  control.takeControl();
  await assert.rejects(control.run(() => assert.fail('Must not run')), /paused/);
  control.resume();
  assert.equal(control.status().request.id, request.id);
  assert.equal(control.status().request.outcome, 'continued');
  assert.equal(await control.run(() => 42), 42);
});

test('viewer cannot obtain control before an in-flight command drains', async () => {
  const control = new Control();
  let release;
  const command = control.run(() => new Promise(resolve => { release = resolve; }));
  control.requestHuman('Complete verification.');
  assert.throws(() => control.takeControl(), /Finishing/);
  await assert.rejects(control.run(() => 1), /paused/);
  release();
  await command;
  assert.equal(control.takeControl().mode, 'human');
});

test('closing or cancelling never silently resumes automation', async () => {
  const control = new Control();
  control.requestHuman('Complete verification.');
  control.takeControl();
  control.cancel();
  assert.equal(control.mode, 'paused');
  assert.equal(control.request.outcome, 'cancelled');
  await assert.rejects(control.run(() => 1), /paused/);
});

test('manual show uses the same ownership gate', async () => {
  const control = new Control();
  control.takeControl();
  await assert.rejects(control.run(() => 1), /paused/);
  control.resume();
  assert.equal(await control.run(() => 'ok'), 'ok');
});

test('a later manual show cannot change a cancelled request into permission to resume it', () => {
  const control = new Control();
  control.requestHuman('Finish this step.');
  control.cancel();
  control.takeControl();
  control.resume();
  assert.equal(control.request.outcome, 'cancelled');
});


test('menu pause blocks new commands while an in-flight command finishes; resume restores automation', async () => {
  const control = new Control();
  let release;
  const running = control.run(() => new Promise(resolve => { release = resolve; }));
  assert.equal(control.pause().mode, 'paused');
  await assert.rejects(control.run(() => assert.fail('Must not run')), /paused/);
  release('finished');
  assert.equal(await running, 'finished');
  assert.equal(control.mode, 'paused');
  assert.equal(control.resume().mode, 'agent');
  assert.equal(await control.run(() => 'resumed'), 'resumed');
});

test('menu pause cannot cancel a pending human request', () => {
  const control = new Control();
  const request = control.requestHuman('Finish signing in.').request;
  assert.throws(() => control.pause(), /already paused/);
  assert.equal(control.mode, 'pending');
  assert.equal(request.outcome, null);
});
