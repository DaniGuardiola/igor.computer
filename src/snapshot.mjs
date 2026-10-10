import net from 'node:net';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);

export function qmp(path, command, args = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let buffer = '', negotiated = false;
    const timer = setTimeout(() => finish(new Error('QEMU snapshot command timed out.')), timeout);
    function finish(error, value) { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); }
    socket.on('error', error => finish(error));
    socket.on('end', () => finish(new Error('QEMU disconnected during snapshot operation.')));
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch (error) { return finish(error); }
        if (message.QMP) socket.write(JSON.stringify({ execute: 'qmp_capabilities', id: 'cap' }) + '\n');
        if (message.id === 'cap' && !negotiated) {
          if (message.error) return finish(new Error(message.error.desc));
          negotiated = true;
          socket.write(JSON.stringify({ execute: command, arguments: args, id: 'command' }) + '\n');
        }
        if (message.id === 'command') return finish(message.error ? new Error(message.error.desc) : null, message.return);
      }
    });
  });
}
export async function saveSnapshot(vmDir, qemu) {
  const socket = join(vmDir, 'qmp.sock');
  // HMP can return an error as text even when QMP itself reports success.
  await qmp(socket, 'stop');
  const output = await qmp(socket, 'human-monitor-command', { 'command-line': 'savevm igor-sleep' });
  if (output.trim()) throw new Error(`Snapshot failed: ${output.trim()}`);
  const snapshots = await qmp(socket, 'human-monitor-command', { 'command-line': 'info snapshots' });
  if (!snapshots.includes('igor-sleep')) throw new Error('QEMU did not record the snapshot. VM remains awake.');
  const { stdout: version } = await exec(qemu, ['--version']);
  const marker = join(vmDir, 'igor-sleep.json');
  await writeFile(marker + '.tmp', JSON.stringify({ version: version.split('\n')[0], savedAt: Date.now(), tag: 'igor-sleep' }), { mode: 0o600 });
  await rename(marker + '.tmp', marker);
}
export async function validateSnapshot(vmDir, qemu) {
  const marker = JSON.parse(await readFile(join(vmDir, 'igor-sleep.json'), 'utf8'));
  const { stdout } = await exec(qemu, ['--version']);
  if (marker.version !== stdout.split('\n')[0] || marker.tag !== 'igor-sleep') throw new Error('QEMU changed since VM slept. Restore with the saved QEMU version before upgrading. Saved state retained.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'validate') throw new Error('Unknown snapshot command.');
  await validateSnapshot(process.argv[3], process.argv[4]);
}
