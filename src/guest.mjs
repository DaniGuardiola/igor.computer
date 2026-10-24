import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimeEnv } from './config.mjs';
const exec = promisify(execFile);

export async function guest(args, options = {}) {
  return exec('docker', ['exec', 'igor-computer', ...args], { env: runtimeEnv, timeout: 15000, maxBuffer: 2 * 1024 * 1024, ...options });
}
export async function computer(action, args = {}) {
  try {
    const { stdout } = await guest(['python3', '/opt/igor-computer/computer.py', action, JSON.stringify(args)], { timeout: ((args.timeoutSeconds || 30) + 5) * 1000 });
    return JSON.parse(stdout);
  } catch (error) {
    let detail;
    try { detail = JSON.parse(error.stdout).error; } catch {}
    throw new Error(detail || 'Computer operation failed. Check VM status and retry.');
  }
}

export async function computerBusy() {
  const script = `from pathlib import Path
busy=False
for file in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  parts=file.read_bytes().split(bytes([0]))
  if b'/opt/igor-computer/computer.py' in parts:
   index=parts.index(b'/opt/igor-computer/computer.py')
   if len(parts)>index+1 and parts[index+1]!=b'status': busy=True
 except OSError: pass
print('busy' if busy else 'idle')`;
  const { stdout } = await guest(['python3', '-c', script]);
  return stdout.trim() === 'busy';
}

// This guest credential is never exposed to clients or forwarded from the host.
// Read on every connection so container recreation cannot leave a stale secret.
export async function displayAuthorization() {
  const { stdout } = await guest(['cat', '/tmp/igor-computer-display-auth']);
  if (!/^igor-computer:[A-Za-z0-9_-]{40,60}$/.test(stdout)) throw new Error('Display credentials unavailable.');
  return 'Basic ' + Buffer.from(stdout).toString('base64');
}
export async function displayHealth() {
  const response = await fetch('http://127.0.0.1:18423/vnc.html', {
    headers: { Authorization: await displayAuthorization() }, signal: AbortSignal.timeout(1500),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Browser display unavailable.');
}
