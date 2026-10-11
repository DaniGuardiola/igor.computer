import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, unlink, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { arch } from 'node:os';
import { runtimeRoot, runtimeEnv, vmDir, vmName, idleSeconds, stateDir } from './config.mjs';
import { saveSnapshot, qmp } from './snapshot.mjs';
import { displayHealth } from './guest.mjs';
const exec = promisify(execFile);
const turnFile = join(stateDir, 'turns.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Runtime {
  state = 'starting';
  error = null;
  operation = null;
  lastUsed = Date.now();
  turns = new Set();
  turnWrites = Promise.resolve();
  async command(script) {
    await exec('bash', [join(runtimeRoot, 'scripts', script)], { env: runtimeEnv, timeout: 1200000, maxBuffer: 8 * 1024 * 1024 });
  }
  status() { return { state: this.state, ready: this.state === 'awake' || this.state === 'sleeping', issues: this.error ? [this.error] : [], activeTurns: this.turns.size, turnIds: [...this.turns], idleSeconds }; }
  async ready() {
    if (this.operation) await this.operation;
    this.lastUsed = Date.now();
    if (this.state === 'awake') return;
    this.operation = this.wake();
    try { await this.operation; } finally { this.operation = null; }
  }
  async health() {
    const response = await fetch('http://127.0.0.1:18422/json/version', { signal: AbortSignal.timeout(1500) });
    if (!response.ok || !(await response.json()).webSocketDebuggerUrl) throw new Error('Browser unavailable.');
    await displayHealth();
  }
  async wake() {
    this.state = 'waking'; this.error = null;
    let sleeping = false;
    try { await access(join(vmDir, 'igor-sleep.json')); sleeping = true; } catch {}
    try {
      // A server update must not recreate a healthy guest or disturb its pages.
      // RAM restore still follows the snapshot path below when a marker exists.
      if (!sleeping) {
        try {
          await this.health();
          this.state = 'awake'; return;
        } catch { /* An unavailable guest needs the normal startup path. */ }
      }
      await this.command('start-vm.sh');
      // A restored container must not be rebuilt/recreated before memory recovery.
      if (!sleeping) { await this.command('build-browser.sh'); await this.command('start-browser.sh'); }
      for (let attempt = 0; attempt < 90; attempt++) {
        try {
          await this.health();
          if (sleeping) await unlink(join(vmDir, 'igor-sleep.json'));
          this.state = 'awake'; return;
        } catch {}
        await delay(1000);
      }
      throw new Error('Computer did not become ready after wake.');
    } catch (error) { this.state = 'error'; this.error = error.message; throw error; }
  }
  async beginTurn(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Provide a stable turn ID, 1-100 letters, numbers, _ or -.');
    this.turns.add(id); await this.persistTurns(); this.lastUsed = Date.now(); return this.status();
  }
  async endTurn(id) {
    if (typeof id !== 'string' || !id) throw new Error('Provide the turn ID.');
    this.turns.delete(id); await this.persistTurns(); this.lastUsed = Date.now(); return this.status();
  }
  persistTurns() {
    const value = JSON.stringify([...this.turns]);
    const next = this.turnWrites.then(async () => {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await writeFile(turnFile + '.tmp', value, { mode: 0o600 });
      await rename(turnFile + '.tmp', turnFile);
    });
    this.turnWrites = next.catch(() => {});
    return next;
  }
  async sleep(control) {
    if (this.operation || control.busy || control.humanBusy || control.viewerOpen || !['agent', 'paused'].includes(control.mode) || this.turns.size) throw new Error('Cannot sleep during a turn, computer action or human takeover.');
    if (this.state === 'sleeping') return this.status();
    if (this.state !== 'awake') throw new Error('Computer is not awake.');
    this.state = 'saving';
    this.operation = (async () => {
      try {
        const qemu = `qemu-system-${arch() === 'arm64' ? 'aarch64' : 'x86_64'}`;
        await exec('docker', ['exec', 'igor-vm', 'sync'], { env: runtimeEnv, timeout: 10000 });
        await saveSnapshot(vmDir, qemu);
        // Force stops QEMU without asking the saved guest to shut down.
        await exec('limactl', ['stop', '--force', vmName], { env: runtimeEnv, timeout: 30000 });
        this.state = 'sleeping'; this.error = null;
      } catch (error) {
        this.error = error.message;
        // A failed save must leave the live machine usable, never silently stop it.
        try {
          await qmp(join(vmDir, 'qmp.sock'), 'cont');
          await unlink(join(vmDir, 'igor-sleep.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
          this.state = 'awake';
        } catch { this.state = 'error'; }
        // Back off automatic retries until another operation or explicit sleep.
        this.lastUsed = Date.now();
        throw error;
      }
    })();
    try { await this.operation; } finally { this.operation = null; }
    return this.status();
  }
  async recoverState() {
    try { this.turns = new Set(JSON.parse(await readFile(turnFile, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // On service restart retain sleeping memory without waking it for status polling.
    try {
      await access(join(vmDir, 'igor-sleep.json'));
      const { stdout } = await exec('limactl', ['list', vmName, '--format', '{{.Status}}'], { env: runtimeEnv });
      if (stdout.trim() !== 'Running') { this.state = 'sleeping'; return; }
      // Crash between save and stop: never load an old snapshot over a live guest.
      await qmp(join(vmDir, 'qmp.sock'), 'cont');
      await unlink(join(vmDir, 'igor-sleep.json'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.ready();
  }
  async idle(control) {
    if (idleSeconds && this.state === 'awake' && Date.now() - this.lastUsed >= idleSeconds * 1000 && !this.operation && !this.turns.size && !control.busy && !control.humanBusy && !control.viewerOpen && ['agent', 'paused'].includes(control.mode)) {
      await this.sleep(control);
    }
  }
}
