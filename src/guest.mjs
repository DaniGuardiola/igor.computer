import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { windowCommand } from './windows.mjs';
const exec = promisify(execFile);

// Every computer VM runs its own Docker daemon, so the container name is fixed.
export const container = 'igor-computer';
// The base image's OS manifest, used until the computer's own image is read.
export const defaultManifest = {
  contract: 1, control: ['python3', '/opt/igor-computer/computer.py'], setup: ['python3', '/opt/igor-computer/setup.py'],
  display: { port: 6080, auth: '/tmp/igor-computer-display-auth' }, browsers: [{ name: 'chromium', cdpPort: 9222 }],
  desktopTools: ['computer-use-linux', 'mcp'], mcp: {},
};

export class Guest {
  constructor(context, manifest = defaultManifest) { this.context = context; this.manifest = manifest; }
  exec(args, options = {}) {
    return exec('docker', ['exec', container, ...args], { env: this.context.env, timeout: 15000, maxBuffer: 2 * 1024 * 1024, ...options });
  }
  async computer(action, args = {}) {
    try {
      const { stdout } = await this.exec([...this.manifest.control, action, JSON.stringify(args)], { timeout: ((args.timeoutSeconds || 30) + 5) * 1000 });
      return JSON.parse(stdout);
    } catch (error) {
      let detail;
      try { detail = JSON.parse(error.stdout).error; } catch {}
      throw new Error(detail || 'Computer operation failed. Check VM status and retry.');
    }
  }
  async busy() {
    return (await this.computer('status')).busy === true;
  }
  async windows(action = 'list', args = {}) {
    const command = windowCommand(action, args);
    try {
      const { stdout } = await this.exec(command, { timeout: 8000, maxBuffer: 256 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      let detail;
      try { detail = JSON.parse(error.stdout).error; } catch {}
      throw new Error(detail || 'Browser windows are temporarily unavailable. Retry shortly.');
    }
  }
  // This guest credential is never exposed to clients or forwarded from the host.
  // Read on every connection so container recreation cannot leave a stale secret.
  async displayAuthorization() {
    const { stdout } = await this.exec(['cat', this.manifest.display.auth]);
    if (!/^[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_-]{20,128}$/.test(stdout)) throw new Error('Display credentials unavailable.');
    return 'Basic ' + Buffer.from(stdout).toString('base64');
  }
  async displayHealth() {
    const response = await fetch(this.context.displayUrl + '/vnc.html', {
      headers: { Authorization: await this.displayAuthorization() }, signal: AbortSignal.timeout(1500),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Computer display unavailable.');
  }
  async setup() {
    if (!this.manifest.setup) return { ok: true, steps: [] };
    try {
      const { stdout } = await this.exec([...this.manifest.setup], { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      let detail;
      try { detail = JSON.parse(error.stdout).error; } catch {}
      throw new Error('Computer setup failed: ' + (detail || error.message).slice(0, 2000));
    }
  }
  async browserHealth() {
    const response = await fetch(this.context.cdpUrl + '/json/version', { signal: AbortSignal.timeout(1500) });
    if (!response.ok || !(await response.json()).webSocketDebuggerUrl) throw new Error('Browser unavailable.');
  }
}
