import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export function appearanceValue(mode = 'system', hostDark = false) {
  if (!['system', 'light', 'dark'].includes(mode) || typeof hostDark !== 'boolean') throw new Error('Invalid appearance setting.');
  return { mode, hostDark, dark: mode === 'dark' || (mode === 'system' && hostDark) };
}

// The host-wide preference. Each computer applies it when awake.
export class Appearance {
  constructor(stateDir) {
    this.file = join(stateDir, 'appearance.json');
    this.value = appearanceValue();
    this.writes = Promise.resolve();
  }
  async load() {
    try { const value = JSON.parse(await readFile(this.file, 'utf8')); this.value = appearanceValue(value.mode, value.hostDark); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  set(mode, hostDark) {
    const value = appearanceValue(mode, hostDark);
    const next = this.writes.then(async () => {
      await writeFile(this.file + '.tmp', JSON.stringify(value), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      this.value = value;
      return value;
    });
    this.writes = next.catch(() => {});
    return next;
  }
}

export class AppliedAppearance {
  constructor(appearance, apply) { this.appearance = appearance; this.apply = apply; this.queue = Promise.resolve(); }
  reset() { this.appliedDark = undefined; }
  ensure() {
    const next = this.queue.then(async () => {
      const { dark } = this.appearance.value;
      if (this.appliedDark !== dark) {
        await this.apply(dark);
        this.appliedDark = dark;
      }
      return this.appearance.value;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

export async function applyGuestAppearance(computer, dark) {
  try { return await computer('appearance', { dark }); }
  catch (error) { throw new Error('Could not apply desktop appearance: ' + error.message.slice(0, 240)); }
}
