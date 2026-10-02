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

test('explicit cancellation never silently resumes automation', async () => {
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


test('window actions require human ownership and drain before automation resumes', async () => {
  const control = new Control();
  await assert.rejects(control.runHuman(() => assert.fail('Must not run')), /Open the browser/);
  control.takeControl();
  let release;
  const action = control.runHuman(() => new Promise(resolve => { release = resolve; }));
  assert.throws(() => control.resume(), /Finishing a window action/);
  control.cancel();
  assert.throws(() => control.resume(), /Finishing a window action/);
  release();
  await action;
  assert.equal(control.resume().mode, 'agent');
});


test('automation setting is independent of human ownership and closing follows it', async () => {
  const control = new Control();
  control.takeControl();
  control.setAutomationPaused(true);
  assert.equal(control.mode, 'human');
  control.setAutomationPaused(false);
  assert.equal(control.mode, 'human');
  await assert.rejects(control.run(() => assert.fail('Must not run')), /paused/);
  assert.equal(control.closeViewer().mode, 'agent');
  control.pause();
  control.takeControl();
  assert.equal(control.automationPaused, true);
  assert.equal(control.closeViewer().mode, 'paused');
  control.setAutomationPaused(false);
  assert.equal(await control.run(() => 42), 42);
});

test('closing drains human mutations and preserves the pause setting on rejection', async () => {
  const control = new Control();
  control.takeControl();
  let release;
  const action = control.runHuman(() => new Promise(resolve => { release = resolve; }));
  control.setAutomationPaused(true);
  assert.throws(() => control.closeViewer(), /Finishing/);
  assert.equal(control.mode, 'human');
  release();
  await action;
  assert.equal(control.closeViewer().mode, 'paused');
});


test('closing while paused leaves a human request waiting until automation resumes', () => {
  const control = new Control();
  control.requestHuman('Complete verification.');
  control.takeControl();
  control.setAutomationPaused(true);
  control.closeViewer();
  assert.equal(control.request.outcome, null);
  assert.equal(control.mode, 'paused');
  control.setAutomationPaused(false);
  assert.equal(control.request.outcome, 'continued');
  assert.equal(control.mode, 'agent');
});
