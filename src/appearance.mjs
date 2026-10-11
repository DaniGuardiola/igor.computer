import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computer } from './guest.mjs';

export function appearanceValue(mode = 'system', hostDark = false) {
  if (!['system', 'light', 'dark'].includes(mode) || typeof hostDark !== 'boolean') throw new Error('Invalid appearance setting.');
  return { mode, hostDark, dark: mode === 'dark' || (mode === 'system' && hostDark) };
}

export class Appearance {
  constructor(stateDir, apply) {
    this.file = join(stateDir, 'appearance.json');
    this.value = appearanceValue();
    this.apply = apply;
    this.queue = Promise.resolve();
  }
  async load() {
    try { const value = JSON.parse(await readFile(this.file, 'utf8')); this.value = appearanceValue(value.mode, value.hostDark); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  set(mode, hostDark) {
    const value = appearanceValue(mode, hostDark);
    const next = this.queue.then(async () => {
      if (this.appliedDark === value.dark && this.value.mode === value.mode && this.value.hostDark === value.hostDark) return this.value;
      if (this.appliedDark !== value.dark) await this.apply(value.dark);
      await writeFile(this.file + '.tmp', JSON.stringify(value), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      this.value = value;
      this.appliedDark = value.dark;
      return value;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  ensure() {
    const next = this.queue.then(async () => {
      if (this.appliedDark !== this.value.dark) {
        await this.apply(this.value.dark);
        this.appliedDark = this.value.dark;
      }
      return this.value;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

export async function applyGuestAppearance(dark) {
  const script = await readFile(fileURLToPath(new URL('./guest-appearance.py', import.meta.url)));
  // Base64 contains no shell metacharacters; the script is bundled trusted code.
  const result = await computer('exec', { command: "python3 -c \"import base64;exec(base64.b64decode('" + script.toString('base64') + "'))\" " + (dark ? 'dark' : 'light'), timeoutSeconds: 20 });
  if (result.exitCode !== 0 || result.timedOut) throw new Error('Could not apply desktop appearance: ' + (result.stderr || 'guest command failed').slice(0, 240));
  return result;
}
