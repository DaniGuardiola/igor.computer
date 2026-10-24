import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { limaHome, runtimeEnv, stateDir } from './config.mjs';

export const namePattern = /^[a-z][a-z0-9-]{0,19}$/;
export const defaultComputer = 'default';
const firstPort = 18430;

export function isGitSource(source) {
  return /^(https:\/\/|git@|ssh:\/\/)/.test(source);
}

export function validateName(name) {
  if (typeof name !== 'string' || !namePattern.test(name)) throw new Error('Computer names use 1-20 lowercase letters, digits and dashes, starting with a letter.');
  return name;
}

// Each computer is its own Lima VM with its own Docker daemon, so the container,
// image and volume names inside it never vary. Only host-side names do.
export function computerContext(name, entry, root = stateDir) {
  const vmName = 'igor-computer-' + name;
  const vmDir = join(limaHome, vmName);
  const dir = join(root, 'computers', name);
  return {
    // Git sources are checked out into the computer's own folder.
    name, dir, vmName, vmDir, origin: entry.source ?? null,
    source: entry.source ? join(isGitSource(entry.source) ? join(dir, 'source') : entry.source, entry.path || '') : null,
    cdpPort: entry.cdpPort, displayPort: entry.displayPort,
    cdpUrl: `http://127.0.0.1:${entry.cdpPort}`, displayUrl: `http://127.0.0.1:${entry.displayPort}`,
    env: { ...runtimeEnv, DOCKER_HOST: `unix://${vmDir}/sock/docker.sock`, IGOR_COMPUTER_VM: vmName, IGOR_COMPUTER_DIR: dir,
      IGOR_COMPUTER_CDP_PORT: String(entry.cdpPort), IGOR_COMPUTER_DISPLAY_PORT: String(entry.displayPort) },
  };
}

export class Registry {
  constructor(root = stateDir) { this.root = root; this.file = join(root, 'computers.json'); this.writes = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(this.file, 'utf8')).computers || {}; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return {}; }
  }
  update(change) {
    const next = this.writes.then(async () => {
      const computers = await this.read();
      const result = await change(computers);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await writeFile(this.file + '.tmp', JSON.stringify({ computers }, null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      return result;
    });
    this.writes = next.catch(() => {});
    return next;
  }
  // Host ports are allocated once and kept, so Lima's static forwards stay valid.
  create(name, source = null, path = '') {
    validateName(name);
    if (path && (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..'))) throw new Error('Definition path must be relative to the source.');
    return this.update(computers => {
      if (computers[name]) throw new Error(`Computer ${name} already exists.`);
      const used = new Set(Object.values(computers).flatMap(item => [item.cdpPort, item.displayPort]));
      let cdpPort = firstPort;
      while (used.has(cdpPort) || used.has(cdpPort + 1)) cdpPort += 2;
      computers[name] = { source, ...(path ? { path } : {}), cdpPort, displayPort: cdpPort + 1, createdAt: Date.now() };
      return computers[name];
    });
  }
  remove(name) {
    return this.update(computers => {
      if (!computers[name]) throw new Error(`Unknown computer ${name}.`);
      delete computers[name];
    });
  }
  async ensureDefault() {
    const computers = await this.read();
    if (!computers[defaultComputer]) await this.create(defaultComputer);
  }
}
