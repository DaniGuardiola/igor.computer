import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const directory = await mkdtemp(join(tmpdir(), 'igor-computer-test-'));
process.env.IGOR_COMPUTER_STATE_DIR = directory;
process.env.IGOR_COMPUTER_LIMA_HOME = directory;
const { Runtime } = await import('../src/runtime.mjs');
const { Control } = await import('../src/control.mjs');
const { qmp, saveSnapshot, validateSnapshot } = await import('../src/snapshot.mjs');
test.after(() => rm(directory, { recursive: true, force: true }));

test('sleep rejects active turns, pending help, human takeover and in-flight mutations', async () => {
  const runtime = new Runtime(); runtime.state = 'awake';
  const control = new Control();
  await runtime.beginTurn('turn-a');
  await assert.rejects(runtime.sleep(control), /Cannot sleep/);
  await runtime.endTurn('turn-a');
  for (const mode of ['pending', 'human']) {
    control.mode = mode;
    await assert.rejects(runtime.sleep(control), /Cannot sleep/);
  }
  control.mode = 'agent'; control.busy = true;
  await assert.rejects(runtime.sleep(control), /Cannot sleep/);
  control.busy = false; control.humanBusy = true;
  await assert.rejects(runtime.sleep(control), /Cannot sleep/);
  control.humanBusy = false; runtime.operation = Promise.resolve();
  await assert.rejects(runtime.sleep(control), /Cannot sleep/);
});

test('turn leases survive server restart and require explicit release', async () => {
  const runtime = new Runtime();
  await assert.rejects(runtime.beginTurn('../unsafe'), /stable turn ID/);
  await runtime.beginTurn('persistent-turn');
  const restarted = new Runtime(); restarted.ready = async () => {};
  await restarted.recoverState();
  assert.deepEqual(restarted.status().turnIds, ['persistent-turn']);
  await restarted.endTurn('persistent-turn');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'turns.json'), 'utf8')), []);
});

test('idle timer cannot sleep through a gap in an active turn', async () => {
  const runtime = new Runtime(); runtime.state = 'awake';
  const control = new Control(); let slept = 0;
  runtime.sleep = async () => { slept++; };
  await runtime.beginTurn('gap'); runtime.lastUsed = 0;
  await runtime.idle(control); assert.equal(slept, 0);
  await runtime.endTurn('gap'); runtime.lastUsed = 0;
  await runtime.idle(control); assert.equal(slept, 1);
});

async function mockQmp(path, responder) {
  const server = net.createServer(socket => {
    socket.write(JSON.stringify({ QMP: { version: {} } }) + '\n');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), request = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        const response = request.id === 'cap' ? {} : responder(request);
        socket.write(JSON.stringify({ return: response, id: request.id }) + '\n');
      }
    });
  });
  await new Promise(resolve => server.listen(path, resolve));
  return server;
}

test('textual savevm error is failure, even with successful QMP response', async () => {
  const path = join(directory, 'qmp.sock');
  const server = await mockQmp(path, request => request.execute === 'stop' ? {} : 'Error: device cannot be snapshotted');
  try { await assert.rejects(saveSnapshot(directory, process.execPath), /device cannot be snapshotted/); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

test('snapshot restore refuses a changed QEMU version instead of losing saved state', async () => {
  await writeFile(join(directory, 'igor-sleep.json'), JSON.stringify({ version: 'wrong version', tag: 'igor-sleep' }));
  await assert.rejects(validateSnapshot(directory, process.execPath), /QEMU changed/);
  assert.ok(await readFile(join(directory, 'igor-sleep.json')));
});


test('server restart adopts a healthy guest without rebuilding or restarting Chromium', async () => {
  const runtime = new Runtime();
  runtime.health = async () => {};
  runtime.command = async () => assert.fail('Healthy guest must not be rebuilt.');
  await runtime.ready();
  assert.equal(runtime.state, 'awake');
});
