import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

export const stateDir = process.env.IGOR_COMPUTER_STATE_DIR ||
  (platform() === 'darwin' ? join(homedir(), 'Library/Application Support/igor.computer') : join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'igor-computer'));
const allowed = ['HOST','PORT','ORIGIN','IDLE_SECONDS','NAME','LIMA_HOME','DOCKER_HOST'];
try {
  const config = JSON.parse(await readFile(join(stateDir, 'server.json'), 'utf8'));
  for (const key of allowed) if (config[key] !== undefined && process.env['IGOR_COMPUTER_' + key] === undefined) process.env['IGOR_COMPUTER_' + key] = String(config[key]);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
export const vmName = process.env.IGOR_COMPUTER_NAME || 'igor-computer';
if (!/^[a-z][a-z0-9-]{0,50}$/.test(vmName)) throw new Error('Invalid VM name.');
export const vmDir = join(process.env.IGOR_COMPUTER_LIMA_HOME || process.env.LIMA_HOME || join(homedir(), '.lima'), vmName);
export const port = Number(process.env.IGOR_COMPUTER_PORT || 18420);
export const host = process.env.IGOR_COMPUTER_HOST || '127.0.0.1';
export const origin = process.env.IGOR_COMPUTER_ORIGIN || `http://${host}:${port}`;
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('IGOR_COMPUTER_ORIGIN must be an HTTP(S) origin.');
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && url.protocol !== 'https:') throw new Error('Remote binding requires an HTTPS public origin and a TLS reverse proxy.');
export const dockerHost = process.env.IGOR_COMPUTER_DOCKER_HOST || `unix://${vmDir}/sock/docker.sock`;
export const runtimeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const runtimeEnv = { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin`, DOCKER_HOST: dockerHost };
delete runtimeEnv.DOCKER_CONTEXT;
export const idleSeconds = Number(process.env.IGOR_COMPUTER_IDLE_SECONDS ?? 300);
if (!Number.isFinite(idleSeconds) || idleSeconds < 0) throw new Error('Invalid idle timeout.');
