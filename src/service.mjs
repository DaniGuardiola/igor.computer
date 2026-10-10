import http from 'node:http';
import { stateDir, origin, host, port } from './config.mjs';
import { Runtime } from './runtime.mjs';
import { computer, computerBusy, displayAuthorization, displayHealth } from './guest.mjs';
import { computerTools } from './computer-tools.mjs';
import { createMcpServer } from './mcp-server.mjs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { browserWindows } from './windows.mjs';
import { Control } from './control.mjs';
import { nativeReadiness } from './readiness.mjs';

process.umask(0o077);
const base = dirname(fileURLToPath(import.meta.url));
const runtimeManager = new Runtime();
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
  control.automationPaused = previous.automationPaused === true;
  if (previous.mode !== 'agent' || previous.busy || previous.humanBusy) {
    control.mode = 'paused';
    control.automationPaused = true;
    if (control.request && !control.request.outcome) control.request.outcome = 'cancelled';
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let controlWrites = Promise.resolve();
function persistControl() {
  const value = JSON.stringify(control.status());
  const next = controlWrites.then(async () => {
    await writeFile(controlFile + '.tmp', value, { mode: 0o600 });
    await rename(controlFile + '.tmp', controlFile);
  });
  controlWrites = next.catch(() => {});
  return next;
}
async function runAgent(action) {
  try { return await control.run(async () => { await persistControl(); return action(); }); }
  finally { await persistControl(); }
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
    displayHealth(),
  ]);
  const issues = probes.flatMap((r, i) => r.status === 'rejected' ? [i === 0 ? 'Browser control is unavailable. Open Igor VM setup and retry.' : 'Browser display is unavailable. Open Igor VM setup and retry.'] : []);
  return healthCache = { ready: issues.length === 0, issues, checkedAt: Date.now() };
}
async function getStatus() {
  let native;
  try { native = JSON.parse(await readFile(join(stateDir, 'app-status.json'), 'utf8')); } catch {}
  const setup = nativeReadiness(nativeClientStatus || native);
  const lifecycle = runtimeManager.status();
  const runtime = lifecycle.state === 'awake' ? { ...lifecycle, ...await browserHealth() } : lifecycle;
  return { ...control.status(), setup, runtime, ...(control.mode === 'pending' ? { delivery: setup.notifications ? 'notification' : 'viewer', viewer: origin + '/viewer' } : {}) };
}
async function requireBrowser() {
  await runtimeInitialization;
  await runtimeManager.ready();
  healthCache = null;
  const health = await browserHealth();
  if (!health.ready) throw new Error(health.issues.join(' '));
}
const upstream = new Client({ name: 'igor-vm-service', version: '0.2.0' });
const transportOptions = {
  command: process.execPath,
  args: [join(base, '../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'),
    '--browser-url=http://127.0.0.1:18422', '--no-usage-statistics', '--no-performance-crux'],
  stderr: 'inherit',
};
await upstream.connect(new StdioClientTransport(transportOptions));
const browserClients = new Map([['shared', upstream]]);
async function browserClient(workspace) {
  if (browserClients.has(workspace)) return browserClients.get(workspace);
  if (browserClients.size >= 32) throw new Error('Maximum 32 browser client workspaces.');
  const client = new Client({ name: 'igor-vm-' + workspace, version: '0.2.0' });
  await client.connect(new StdioClientTransport(transportOptions));
  browserClients.set(workspace, client);
  return client;
}
let nativeClientStatus;
const tools = (await upstream.listTools()).tools;
const allTools = [...tools, ...computerTools];
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
  return !req.headers.origin || req.headers.origin === origin;
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
async function dispatch(path, args, signal, workspace = 'shared', label = workspace) {
  if (path === '/status') return getStatus();
  if (path === '/tools') return { tools: allTools };
  if (path === '/request-human') {
    await requireBrowser();
    if (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 300) throw new Error('Provide a short human-help message.');
    if (args.pageId !== undefined) {
      if (!Number.isInteger(args.pageId)) throw new Error('Invalid page ID.');
      await runAgent(async () => (await browserClient(workspace)).callTool({ name: 'select_page', arguments: { pageId: args.pageId, bringToFront: true } }));
    }
    await changeControl(() => control.requestHuman(args.message.trim(), args.pageId));
    return getStatus();
  }
  if (path === '/computer') {
    const { name, arguments: parameters = {} } = args;
    if (!computerTools.some(tool => tool.name === name)) throw new Error('Unknown computer tool.');
    if (name === 'computer_end_turn') return runtimeManager.endTurn(parameters.turnId);
    if (name === 'computer_begin_turn') return runAgent(async () => { await requireBrowser(); return runtimeManager.beginTurn(parameters.turnId); });
    if (name === 'computer_sleep') { await runtimeInitialization; return runtimeManager.sleep(control); }
    return runAgent(async () => {
      await requireBrowser();
      if (name === 'computer_wake') return runtimeManager.status();
      if (['computer_input', 'computer_screenshot'].includes(name)) { await computer('workspace_create', { name: workspace, ...(label !== workspace ? { label } : {}) }); await computer('workspace_select', { name: workspace }); }
      const action = name === 'computer_workspace' ? 'workspace_' + parameters.action : name.slice('computer_'.length);
      return computer(action, parameters);
    });
  }
  if (path === '/call') {
    // Set the busy gate before waking, so takeover cannot race restoration.
    return runAgent(async () => {
      await requireBrowser();
      await computer('workspace_create', { name: workspace, ...(label !== workspace ? { label } : {}) });
      if (!tools.some(tool => tool.name === args.name)) throw new Error('Unknown browser tool.');
      return (await browserClient(workspace)).callTool(args, undefined, { timeout: 120000, signal });
    });
  }
  throw new Error('Unknown MCP route.');
}

const mcpConnections = new Set();
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(origin).host || !sameOrigin(req)) return json(res, { error: 'Invalid origin.' }, 403);
    const path = new URL(req.url, origin).pathname;
    const workspace = req.headers['x-igor-workspace'] || 'shared';
    const label = decodeURIComponent(req.headers['x-igor-workspace-label'] || workspace);
    if (typeof label !== 'string' || label.length > 80 || !label.trim()) throw new Error('Invalid workspace label.');
    if (typeof workspace !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(workspace)) throw new Error('Invalid client workspace.');
    if (path === '/viewer' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${new URL(origin).origin.replace(/^http/, "ws")}; frame-ancestors 'none'` });
      return res.end(viewer);
    }
    if (!authorized(req)) return json(res, { error: 'Unauthorized.' }, 401);
    if (path === '/session' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `igor_browser=${token}; HttpOnly; SameSite=Strict; Path=/${origin.startsWith('https:') ? '; Secure' : ''}`);
      return json(res, { ok: true });
    }
    if (path === '/mcp') {
      if (req.method !== 'POST') return json(res, { error: 'Use stateless streamable HTTP POST.' }, 405);
      const mcp = createMcpServer((path, args, signal) => dispatch(path, args, signal, workspace, label));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      mcpConnections.add(mcp);
      res.on('close', () => { mcpConnections.delete(mcp); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, await body(req));
      return;
    }
    if (path.startsWith('/vnc/') && req.method === 'GET') {
      req.headers.authorization = await displayAuthorization();
      delete req.headers.cookie;
      req.url = req.url.slice(4);
      return proxy.web(req, res);
    }
    if (path === '/status' && req.method === 'GET') return json(res, await getStatus());
    if (path === '/windows' && req.method === 'GET') {
      if (control.mode !== 'human') throw new Error('Open the browser to manage windows.');
      await requireBrowser();
      return json(res, await browserWindows());
    }
    if (path === '/workspaces' && req.method === 'GET') {
      if (control.mode !== 'human') throw new Error('Open the computer to manage workspaces.');
      return json(res, await computer('workspace_list'));
    }
    if (path === '/tools' && req.method === 'GET') return json(res, { tools: allTools });
    if (req.method !== 'POST') return json(res, { error: 'Not found.' }, 404);
    const args = await body(req);
    if (path === '/workspaces') {
      if (!['select', 'create', 'open_browser'].includes(args.action)) throw new Error('Unknown workspace action.');
      return json(res, await control.runHuman(async () => {
        if (args.action === 'open_browser' && !args.name) {
          const state = await computer('workspace_list');
          args.name = state.workspaces.find(workspace => workspace.active)?.name;
        }
        const result = await computer('workspace_' + args.action, args);
        if (args.action === 'create') return computer('workspace_select', { name: args.name });
        return result;
      }));
    }
    if (path === '/client-status') { nativeClientStatus = { ...args, checkedAt: Date.now() }; return json(res, { ok: true }); }
    if (path === '/computer') return json(res, await dispatch('/computer', args, undefined, workspace, label));
    if (path === '/request-human') return json(res, await dispatch(path, args, undefined, workspace, label));
    if (path === '/windows' && req.method === 'POST') {
      if (control.mode !== 'human') throw new Error('Open the browser to manage windows.');
      return json(res, await control.runHuman(() => browserWindows(args.action, args)));
    }
    if (path === '/take-control') {
      const intervention = control.mode === 'pending';
      await changeControl(() => control.takeControl());
      control.humanBusy = true;
      try {
        await requireBrowser();
        if (await computerBusy()) throw new Error('Finishing an interrupted computer command. Retry shortly.');
        if (!intervention) await computer('workspace_select', { name: 'shared' });
      } catch (error) {
        control.mode = 'paused'; control.automationPaused = true;
        throw error;
      } finally { control.humanBusy = false; await persistControl(); }
      return json(res, control.status());
    }
    if (path === '/automation-pause') { const status = await changeControl(() => control.setAutomationPaused(args.paused)); return json(res, status); }
    if (path === '/close-viewer') { const status = await changeControl(() => { const status = control.closeViewer(); runtimeManager.lastUsed = Date.now(); disconnectViewer(); return status; }); return json(res, status); }
    if (path === '/pause') { const status = await changeControl(() => control.pause()); return json(res, status); }
    if (path === '/resume') { const status = await changeControl(() => { const status = control.resume(); disconnectViewer(); return status; }); return json(res, status); }
    if (path === '/cancel') { disconnectViewer(); const status = await changeControl(() => control.cancel()); return json(res, status); }
    if (path === '/shutdown') { json(res, { ok: true }); setImmediate(close); return; }
    if (path === '/call') return json(res, await dispatch(path, args, undefined, workspace, label));
    return json(res, { error: 'Not found.' }, 404);
  } catch (error) { json(res, { error: error.message }, 409); }
});
server.on('upgrade', async (req, socket, head) => {
  if (req.headers.host !== new URL(origin).host || !sameOrigin(req) || !authorized(req) || (control.mode !== 'human' || control.humanBusy) || req.url !== '/vnc/websockify') return socket.destroy();
  try {
    req.headers.authorization = await displayAuthorization();
    delete req.headers.cookie;
    // Ownership may change while reading the backend credential.
    if (control.mode !== 'human' || control.humanBusy || socket.destroyed) return socket.destroy();
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    req.url = '/websockify';
    proxy.ws(req, socket, head);
  } catch { socket.destroy(); }
});
server.listen(port, host, () => console.error(`Igor VM server ready at ${origin}`));
// HTTP status remains available during startup, sleep and recovery failures.
const runtimeInitialization = runtimeManager.recoverState().catch(error => { runtimeManager.state = 'error'; runtimeManager.error = error.message; console.error('VM startup:', error.message); });
const idleTimer = setInterval(() => { void runtimeManager.idle(control).catch(error => console.error('VM sleep:', error.message)); }, 5000);
idleTimer.unref();
async function close() {
  clearInterval(idleTimer);
  disconnectViewer();
  server.close();
  for (const mcp of mcpConnections) await mcp.close();
  for (const client of browserClients.values()) await client.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
