import test from 'node:test';
import assert from 'node:assert/strict';
import { Control } from '../src/control.mjs';

test('help requests never block automation; handing back control answers them', async () => {
  const control = new Control();
  const request = control.requestHuman('Sign in to the test site.', 1);
  assert.equal(await control.run(() => 'still working'), 'still working');
  assert.equal(control.mode, 'agent');
  control.takeControl();
  await assert.rejects(control.run(() => assert.fail('Must not run')), /paused/);
  control.resume();
  assert.equal(request.outcome, 'continued');
  assert.equal(control.status().request, null);
  assert.equal(await control.run(() => 42), 42);
});
test('viewer cannot obtain control before an in-flight command drains', async () => {
  const control = new Control();
  let release;
  const command = control.run(() => new Promise(resolve => { release = resolve; }));
  control.requestHuman('Complete verification.');
  assert.throws(() => control.takeControl(), /Finishing/);
  await assert.rejects(control.run(() => 1), /busy/);
  release();
  await command;
  assert.equal(control.takeControl().mode, 'human');
});

test('the person can dismiss a request without pausing anything', async () => {
  const control = new Control();
  const request = control.requestHuman('Complete verification.');
  control.dismiss(request.id);
  assert.equal(request.outcome, 'dismissed');
  assert.equal(control.mode, 'agent');
  assert.equal(await control.run(() => 1), 1);
  assert.throws(() => control.dismiss(request.id), /No open help request/);
});
test('manual show uses the same ownership gate', async () => {
  const control = new Control();
  control.takeControl();
  await assert.rejects(control.run(() => 1), /paused/);
  control.resume();
  assert.equal(await control.run(() => 'ok'), 'ok');
});

test('agents withdraw only their own requests, and a newer request replaces theirs', () => {
  const control = new Control();
  const first = control.requestHuman('Sign in.', undefined, 'ivo');
  const other = control.requestHuman('Pay the invoice.', undefined, 'doc');
  assert.throws(() => control.withdraw(first.id, 'doc'), /from this workspace/);
  const second = control.requestHuman('Sign in again.', undefined, 'ivo');
  assert.equal(first.outcome, 'replaced');
  assert.equal(control.withdraw(second.id, 'ivo').outcome, 'withdrawn');
  assert.deepEqual(control.openRequests().map(item => item.id), [other.id]);
  control.takeControl('ivo'); control.release();
  assert.equal(other.outcome, null);
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

test('pausing automation leaves help requests open', () => {
  const control = new Control();
  const request = control.requestHuman('Finish signing in.');
  assert.equal(control.pause().mode, 'paused');
  assert.equal(request.outcome, null);
});

test('open requests expire after a day and resolved ones are forgotten after an hour', () => {
  const control = new Control();
  const old = control.requestHuman('Old.'); old.createdAt -= 25 * 3600 * 1000;
  const done = control.requestHuman('Done.', undefined, 'doc'); control.dismiss(done.id); done.resolvedAt -= 2 * 3600 * 1000;
  assert.deepEqual(control.openRequests(), []);
  assert.equal(old.outcome, 'expired');
  assert.deepEqual(control.status().requests.map(item => item.id), [old.id]);
});
test('window actions require human ownership and drain before automation resumes', async () => {
  const control = new Control();
  await assert.rejects(control.runHuman(() => assert.fail('Must not run')), /Open the browser/);
  control.takeControl();
  let release;
  const action = control.runHuman(() => new Promise(resolve => { release = resolve; }));
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


test('closing the viewer after helping answers the request even while paused', () => {
  const control = new Control();
  const request = control.requestHuman('Complete verification.');
  control.takeControl();
  control.setAutomationPaused(true);
  control.closeViewer();
  assert.equal(request.outcome, 'continued');
  assert.equal(control.mode, 'paused');
});
test('watching never blocks agents; takeover only blocks its workspace and physical input', async () => {
  const control = new Control();
  control.watch('ivo');
  assert.equal(control.mode, 'agent');
  assert.equal(await control.run(() => 1, 'ivo'), 1);
  control.takeControl('ivo');
  await assert.rejects(control.run(() => assert.fail(), 'ivo'), /paused/);
  assert.equal(await control.run(() => 2, 'doc'), 2);
  await assert.rejects(control.run(() => assert.fail(), 'doc', true), /paused/);
  control.release();
  assert.equal(control.viewerOpen, true);
  assert.equal(control.viewedWorkspace, 'ivo');
  assert.equal(await control.run(() => 3, 'ivo'), 3);
  control.takeControl('ivo');
  control.watch('doc');
  assert.equal(control.humanWorkspace, null);
  assert.equal(await control.run(() => 4, 'ivo'), 4);
});

test('global pause applies across workspaces and survives leaving takeover', async () => {
  const control = new Control();
  control.watch('ivo'); control.takeControl('ivo'); control.setAutomationPaused(true);
  await assert.rejects(control.run(() => assert.fail(), 'doc'), /paused/);
  control.release();
  assert.equal(control.mode, 'paused');
  control.closeViewer();
  assert.equal(control.viewerOpen, false);
  assert.equal(control.automationPaused, true);
});


test('global pause toggles independently of open help requests', async () => {
  const control = new Control();
  const request = control.requestHuman('Sign in.', 1, 'ivo');
  control.setAutomationPaused(true);
  await assert.rejects(control.run(() => assert.fail(), 'doc'), /paused/);
  control.setAutomationPaused(false);
  assert.equal(request.outcome, null);
  assert.equal(control.status().request.id, request.id);
  assert.equal(await control.run(() => 1, 'doc'), 1);
});
test('independent browser clients overlap while the personal desktop is being used', async () => {
  const control = new Control();
  control.takeControl('shared');
  let releaseBrowser, releaseHuman;
  const human = control.runHuman(() => new Promise(resolve => { releaseHuman = resolve; }));
  const first = control.run(() => new Promise(resolve => { releaseBrowser = resolve; }), 'ivo');
  assert.equal(await control.run(() => 2, 'doc'), 2);
  assert.equal(control.busy, true);
  await assert.rejects(control.run(() => assert.fail(), 'ivo'), /busy/);
  await assert.rejects(control.run(() => assert.fail(), 'shared'), /paused/);
  await assert.rejects(control.run(() => assert.fail(), 'doc', true), /paused/);
  releaseBrowser(); releaseHuman();
  await Promise.all([first, human]);
  assert.equal(control.busy, false);
});

test('takeover drains only its workspace and physical input; errors release the gate', async () => {
  const control = new Control();
  let release;
  const running = control.run(() => new Promise(resolve => { release = resolve; }), 'ivo');
  assert.equal(control.takeControl('doc').mode, 'human');
  await assert.rejects(control.run(() => { throw new Error('failed'); }, 'nora'), /failed/);
  assert.equal(await control.run(() => 3, 'nora'), 3);
  release(); await running;
  assert.equal(control.busy, false);
});


test('physical desktop input cannot race browser setup in another workspace', async () => {
  const control = new Control(); let release;
  const browser = control.run(() => new Promise(resolve => { release = resolve; }), 'ivo');
  await assert.rejects(control.run(() => assert.fail(), 'doc', true), /busy/);
  release(); await browser;
  assert.equal(await control.run(() => 1, 'doc', true), 1);
});
