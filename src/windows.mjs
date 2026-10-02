import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function windowCommand(action, args = {}) {
  if (!['list', 'focus', 'close', 'restore'].includes(action)) throw new Error('Unknown window action.');
  if (action !== 'list' && (typeof args.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(args.generation))) throw new Error('Refresh the browser window list.');
  if (['focus', 'close'].includes(action) && (typeof args.id !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(args.id))) throw new Error('Invalid window ID.');
  return ['--context', 'colima-igor-browser', 'exec', 'igor-browser', 'python3', '/opt/igor-browser/windows.py', action,
    ...(action === 'list' ? [] : [args.id || '', args.generation])];
}

export async function browserWindows(action = 'list', args = {}) {
  const command = windowCommand(action, args);
  try {
    const { stdout } = await exec('/opt/homebrew/bin/docker', command, { timeout: 8000, maxBuffer: 256 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    let detail;
    try { detail = JSON.parse(error.stdout).error; } catch {}
    throw new Error(detail || 'Browser windows are temporarily unavailable. Retry shortly.');
  }
}
