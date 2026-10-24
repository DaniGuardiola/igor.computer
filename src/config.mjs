import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

export const stateDir = process.env.IGOR_COMPUTER_STATE_DIR ||
  (platform() === 'darwin' ? join(homedir(), 'Library/Application Support/igor.computer') : join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'igor-computer'));
const allowed = ['HOST','PORT','ORIGIN','IDLE_SECONDS','LIMA_HOME'];
try {
  const config = JSON.parse(await readFile(join(stateDir, 'server.json'), 'utf8'));
  for (const key of allowed) if (config[key] !== undefined && process.env['IGOR_COMPUTER_' + key] === undefined) process.env['IGOR_COMPUTER_' + key] = String(config[key]);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
export const limaHome = process.env.IGOR_COMPUTER_LIMA_HOME || process.env.LIMA_HOME || join(homedir(), '.lima');
export const port = Number(process.env.IGOR_COMPUTER_PORT || 18420);
export const host = process.env.IGOR_COMPUTER_HOST || '127.0.0.1';
export const origin = process.env.IGOR_COMPUTER_ORIGIN || `http://${host}:${port}`;
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('IGOR_COMPUTER_ORIGIN must be an HTTP(S) origin.');
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && url.protocol !== 'https:') throw new Error('Remote binding requires an HTTPS public origin and a TLS reverse proxy.');
export const runtimeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
// A private Docker config lets the bundled CLI find Homebrew's buildx plugin
// without editing the user's own ~/.docker/config.json.
export const dockerConfig = join(stateDir, 'docker');
export const runtimeEnv = { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin`, LIMA_HOME: limaHome, DOCKER_CONFIG: dockerConfig };
delete runtimeEnv.DOCKER_CONTEXT;
delete runtimeEnv.DOCKER_HOST;
export const idleSeconds = Number(process.env.IGOR_COMPUTER_IDLE_SECONDS ?? 300);
if (!Number.isFinite(idleSeconds) || idleSeconds < 0) throw new Error('Invalid idle timeout.');
