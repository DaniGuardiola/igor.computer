import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Appearance } from './appearance.mjs';
import { stateDir, origin, host, port } from './config.mjs';
import { Registry, computerContext, defaultComputer, isGitSource, validateName } from './computers.mjs';
import { createComputer, devtoolsTools, json, body } from './instance.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeReadiness } from './readiness.mjs';
import { loadDefinition } from './definition.mjs';
const exec = promisify(execFile);

process.umask(0o077);
const base = dirname(fileURLToPath(import.meta.url));
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const tokenFile = join(stateDir, 'token');
let token;
try { token = (await readFile(tokenFile, 'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  token = randomBytes(32).toString('hex');
  await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
}
const appearance = new Appearance(stateDir);
await appearance.load();
const browserTools = await devtoolsTools();
const viewer = await readFile(join(base, 'viewer.html'));
const chromiumIcon = await readFile(join(base, 'assets/chromium.png'));
let nativeClientStatus;
async function setupStatus() {
  let native;
  try { native = JSON.parse(await readFile(join(stateDir, 'app-status.json'), 'utf8')); } catch {}
  return nativeReadiness(nativeClientStatus || native);
}

const registry = new Registry();
await registry.ensureDefault();
const computers = new Map();
function prefix(name) { return name === defaultComputer ? '' : '/computers/' + name; }
async function open(name, entry, options) {
  const instance = await createComputer({ context: computerContext(name, entry), appearance, browserTools, setupStatus, viewerUrl: origin + prefix(name) + '/viewer' });
  computers.set(name, instance);
  instance.start(options);
  return instance;
}
for (const [name, entry] of Object.entries(await registry.read())) await open(name, entry, { autostart: name === defaultComputer });

function secretMatches(value) {
  const actual = Buffer.from(value || '');
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function authorized(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer /, '');
  const cookie = /(?:^|;\s*)igor_computer=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  return secretMatches(bearer) || secretMatches(cookie);
}
function sameOrigin(req) {
  return !req.headers.origin || req.headers.origin === origin;
}
// /computers/<name>/rest addresses one computer; any other path is the default computer.
function route(path) {
  const match = /^\/computers\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return { name: defaultComputer, rest: path };
  return { name: match[1], rest: match[2] || '/' };
}

async function listComputers() {
  return { computers: await Promise.all([...computers.values()].map(instance => instance.summary())) };
}
async function createFromRequest(args) {
  const name = validateName(args.name);
  let source = args.source ?? null;
  if (source !== null) {
    if (typeof source !== 'string' || (!isGitSource(source) && !isAbsolute(source))) throw new Error('Source must be an absolute folder or file path, or a git URL.');
    if (!isGitSource(source)) await loadDefinition(join(source, args.path || ''));
  }
  const entry = await registry.create(name, source, args.path || '');
  const context = computerContext(name, entry);
  try {
    if (source && isGitSource(source)) {
      await mkdir(context.dir, { recursive: true, mode: 0o700 });
      await exec('git', ['clone', '--depth', '1', ...(args.ref ? ['--branch', args.ref] : []), '--', source, join(context.dir, 'source')], { timeout: 300000 });
      await loadDefinition(context.source);
    }
  } catch (error) {
    await registry.remove(name); await rm(context.dir, { recursive: true, force: true });
    throw new Error(error.stderr?.trim() || error.message);
  }
  await open(name, entry);
  return computers.get(name).summary();
}
async function updateSource(name) {
  const instance = computers.get(name);
  if (!instance.context.origin || !isGitSource(instance.context.origin)) throw new Error('Only git-sourced computers can be updated. Edit the folder directly, then rebuild.');
  const { stdout } = await exec('git', ['-C', join(instance.context.dir, 'source'), 'pull', '--ff-only'], { timeout: 300000 });
  await loadDefinition(instance.context.source);
  return { ok: true, output: stdout.trim() };
}
async function removeComputer(name, args) {
  if (args.confirm !== name) throw new Error(`Confirm by sending {"confirm":"${name}"}. This deletes the VM, its logins and /workspace.`);
  const instance = computers.get(name);
  if (instance.busy()) throw new Error('Computer is in use. Finish turns and human control first.');
  computers.delete(name);
  await instance.close();
  await exec('limactl', ['delete', '--force', instance.context.vmName], { env: instance.context.env, timeout: 120000 }).catch(error => { if (!/not found|does not exist/i.test(error.stderr || '')) throw error; });
  await rm(instance.context.dir, { recursive: true, force: true });
  await registry.remove(name);
  if (name === defaultComputer) { await registry.ensureDefault(); await open(defaultComputer, (await registry.read())[defaultComputer]); }
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(origin).host || !sameOrigin(req)) return json(res, { error: 'Invalid origin.' }, 403);
    const path = new URL(req.url, origin).pathname;
    const workspace = req.headers['x-igor-workspace'] || 'shared';
    const label = decodeURIComponent(req.headers['x-igor-workspace-label'] || workspace);
    if (typeof label !== 'string' || label.length > 80 || !label.trim()) throw new Error('Invalid workspace label.');
    if (typeof workspace !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(workspace)) throw new Error('Invalid client workspace.');
    const { name, rest } = route(path);
    if (rest === '/viewer' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${new URL(origin).origin.replace(/^http/, "ws")}; frame-ancestors 'none'` });
      return res.end(viewer);
    }
    if (path === '/assets/chromium.png' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(chromiumIcon);
    }
    if (!authorized(req)) return json(res, { error: 'Unauthorized.' }, 401);
    if (path === '/session' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `igor_computer=${token}; HttpOnly; SameSite=Strict; Path=/${origin.startsWith('https:') ? '; Secure' : ''}`);
      return json(res, { ok: true });
    }
    if (path === '/computers' && req.method === 'GET') return json(res, await listComputers());
    if (path === '/computers' && req.method === 'POST') return json(res, await createFromRequest(await body(req)));
    if (path === '/appearance' && req.method === 'GET') return json(res, appearance.value);
    if (path === '/appearance' && req.method === 'POST') {
      const args = await body(req);
      const value = await appearance.set(args.mode, args.hostDark);
      for (const instance of computers.values()) void instance.applyAppearance()?.catch(error => console.error(`[${instance.context.name}] appearance:`, error.message));
      return json(res, value);
    }
    if (path === '/client-status' && req.method === 'POST') { nativeClientStatus = { ...await body(req), checkedAt: Date.now() }; return json(res, { ok: true }); }
    if (path === '/shutdown' && req.method === 'POST') { json(res, { ok: true }); setImmediate(close); return; }
    const instance = computers.get(name);
    if (!instance) return json(res, { error: `Unknown computer ${name}.` }, 404);
    if (rest === '/' && req.method === 'DELETE') return json(res, await removeComputer(name, await body(req)));
    if (rest === '/update' && req.method === 'POST') return json(res, await updateSource(name));
    return await instance.handle(req, res, rest, { workspace, label });
  } catch (error) { json(res, { error: error.message }, 409); }
});
server.on('upgrade', async (req, socket, head) => {
  if (req.headers.host !== new URL(origin).host || !sameOrigin(req) || !authorized(req)) return socket.destroy();
  const { name, rest } = route(new URL(req.url, origin).pathname);
  const instance = computers.get(name);
  if (!instance) return socket.destroy();
  return instance.upgrade(req, socket, head, rest);
});
server.listen(port, host, () => console.error(`igor.computer server ready at ${origin}`));
const idleTimer = setInterval(() => {
  for (const instance of computers.values()) void instance.idle().catch(error => console.error(`[${instance.context.name}] idle:`, error.message));
}, 5000);
idleTimer.unref();
async function close() {
  clearInterval(idleTimer);
  server.close();
  for (const instance of computers.values()) await instance.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
