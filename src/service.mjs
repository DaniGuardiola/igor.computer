import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { browserWindows } from './windows.mjs';
import { Control } from './control.mjs';
import { nativeReadiness, helpDelivery } from './readiness.mjs';

process.umask(0o077);
const base = dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.IGOR_BROWSER_STATE_DIR || join(homedir(), 'Library/Application Support/Igor Browser');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const tokenFile = join(stateDir, 'token');
let token;
try { token = (await readFile(tokenFile, 'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  token = randomBytes(32).toString('hex');
  await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
}
const control = new Control();
const controlFile = join(stateDir, 'control.json');
try {
  const previous = JSON.parse(await readFile(controlFile, 'utf8'));
  control.request = previous.request || null;
  if (previous.mode !== 'agent') {
    control.mode = 'paused';
    if (control.request && !control.request.outcome) control.request.outcome = 'cancelled';
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
async function persistControl() {
  await writeFile(controlFile + '.tmp', JSON.stringify(control.status()), { mode: 0o600 });
  await rename(controlFile + '.tmp', controlFile);
}
await persistControl();
let transitions = Promise.resolve();
function changeControl(action) {
  const next = transitions.then(async () => {
    const status = action();
    try { await persistControl(); } catch (error) { control.mode = 'paused'; throw error; }
    return status;
  });
  transitions = next.catch(() => {});
  return next;
}
let healthCache;
async function browserHealth() {
  if (healthCache && Date.now() - healthCache.checkedAt < 2000) return healthCache;
  const probes = await Promise.allSettled([
    fetch('http://127.0.0.1:18422/json/version', { signal: AbortSignal.timeout(1500) }).then(async r => {
      if (!r.ok || !(await r.json()).webSocketDebuggerUrl) throw new Error('Browser control unavailable.');
    }),
    fetch('http://127.0.0.1:18423/vnc.html', { signal: AbortSignal.timeout(1500) }).then(async r => {
      if (!r.ok) throw new Error('Browser display unavailable.');
      await r.body?.cancel();
    }),
  ]);
  const issues = probes.flatMap((r, i) => r.status === 'rejected' ? [i === 0 ? 'Browser control is unavailable. Open Igor Browser setup and retry.' : 'Browser display is unavailable. Open Igor Browser setup and retry.'] : []);
  return healthCache = { ready: issues.length === 0, issues, checkedAt: Date.now() };
}
async function getStatus() {
  let native;
  try { native = JSON.parse(await readFile(join(stateDir, 'app-status.json'), 'utf8')); } catch {}
  const setup = nativeReadiness(native);
  const runtime = await browserHealth();
  return { ...control.status(), setup, runtime, ...(control.mode === 'pending' ? { delivery: helpDelivery(setup) } : {}) };
}
async function requireBrowser() {
  const health = await browserHealth();
  if (!health.ready) throw new Error(health.issues.join(' '));
}
const upstream = new Client({ name: 'igor-browser-service', version: '0.1.1' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(base, '../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'),
    '--browser-url=http://127.0.0.1:18422', '--no-usage-statistics', '--no-performance-crux'],
  stderr: 'inherit',
});
await upstream.connect(transport);
const tools = (await upstream.listTools()).tools;
const viewer = await readFile(join(base, 'viewer.html'));
const sockets = new Set();
const proxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:18423', ws: true });
proxy.on('error', (_error, _req, res) => {
  if (res?.writeHead && !res.headersSent) { res.writeHead(502); res.end('Browser display unavailable.'); }
  else res?.destroy?.();
});
function secretMatches(value) {
  const actual = Buffer.from(value || '');
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function authorized(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer /, '');
  const cookie = /(?:^|;\s*)igor_browser=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  return secretMatches(bearer) || secretMatches(cookie);
}
function sameOrigin(req) {
  return !req.headers.origin || req.headers.origin === 'http://127.0.0.1:18420';
}
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 1024 * 1024) throw new Error('Request too large.');
  }
  return data ? JSON.parse(data) : {};
}
function disconnectViewer() {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:18420' || !sameOrigin(req)) return json(res, { error: 'Invalid origin.' }, 403);
    const path = new URL(req.url, 'http://127.0.0.1:18420').pathname;
    if (path === '/viewer' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:18420; frame-ancestors 'none'" });
      return res.end(viewer);
    }
    if (!authorized(req)) return json(res, { error: 'Unauthorized.' }, 401);
    if (path === '/session' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `igor_browser=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res, { ok: true });
    }
    if (path.startsWith('/vnc/') && req.method === 'GET') {
      req.url = req.url.slice(4);
      return proxy.web(req, res);
    }
    if (path === '/status' && req.method === 'GET') return json(res, await getStatus());
    if (path === '/windows' && req.method === 'GET') {
      if (control.mode !== 'human') throw new Error('Open the browser to manage windows.');
      return json(res, await browserWindows());
    }
    if (path === '/tools' && req.method === 'GET') return json(res, { tools });
    if (req.method !== 'POST') return json(res, { error: 'Not found.' }, 404);
    const args = await body(req);
    if (path === '/request-human') {
      await requireBrowser();
      if (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 300) throw new Error('Provide a short message naming the site and required human step.');
      if (args.pageId !== undefined) {
        if (!Number.isInteger(args.pageId)) throw new Error('Invalid page ID.');
        await control.run(() => upstream.callTool({ name: 'select_page', arguments: { pageId: args.pageId, bringToFront: true } }));
      }
      const status = await changeControl(() => control.requestHuman(args.message.trim(), args.pageId));
      return json(res, { ...status, ...await getStatus() });
    }
    if (path === '/windows' && req.method === 'POST') {
      if (control.mode !== 'human') throw new Error('Open the browser to manage windows.');
      return json(res, await control.runHuman(() => browserWindows(args.action, args)));
    }
    if (path === '/take-control') { await requireBrowser(); const status = await changeControl(() => control.takeControl()); return json(res, status); }
    if (path === '/pause') { const status = await changeControl(() => control.pause()); return json(res, status); }
    if (path === '/resume') { const status = await changeControl(() => { const status = control.resume(); disconnectViewer(); return status; }); return json(res, status); }
    if (path === '/cancel') { disconnectViewer(); const status = await changeControl(() => control.cancel()); return json(res, status); }
    if (path === '/shutdown') { json(res, { ok: true }); setImmediate(close); return; }
    if (path === '/call') {
      await requireBrowser();
      if (!tools.some(tool => tool.name === args.name)) throw new Error('Unknown browser tool.');
      return json(res, await control.run(() => upstream.callTool(args, undefined, { timeout: 120000 })));
    }
    return json(res, { error: 'Not found.' }, 404);
  } catch (error) { json(res, { error: error.message }, 409); }
});
server.on('upgrade', (req, socket, head) => {
  if (req.headers.host !== '127.0.0.1:18420' || !sameOrigin(req) || !authorized(req) || control.mode !== 'human' || req.url !== '/vnc/websockify') return socket.destroy();
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  req.url = '/websockify';
  proxy.ws(req, socket, head);
});
server.listen(18420, '127.0.0.1', () => console.error('Igor Browser service ready on 127.0.0.1:18420'));
async function close() {
  disconnectViewer();
  server.close();
  await upstream.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
