import http from 'node:http';
import { Appearance, applyGuestAppearance } from './appearance.mjs';
import { AgentActivity } from './agent-activity.mjs';
import { DesktopView } from './desktop-view.mjs';
import { Watch, activity } from './watch.mjs';
import { Desktop } from './desktop.mjs';
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
import { BrowserWorkspaces, recoveredRequest } from './browser-workspace.mjs';
import { ComputerUse, desktopTools, desktopRequest } from './computer-use.mjs';
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
const appearance = new Appearance(stateDir, applyGuestAppearance);
await appearance.load();
const desktop = new Desktop(stateDir);
const control = new Control();
const watch = new Watch();
const desktopView = new DesktopView();
const activities = new Map();
const agentActivity = new AgentActivity();
function recordActivity(workspace, name, args, extra = {}) {
  const value = activity(name, args);
  if (value) activities.set(workspace, { ...value, ...extra, at: Date.now() });
}
async function viewedState() {
  const state = await desktop.workspaces(await computer('workspace_list'));
  return { ...state, workspaces: state.workspaces.map(item => ({ ...item, active: item.name === control.viewedWorkspace,
    agentState: item.personal ? null : control.humanWorkspace === item.name ? 'controlled' : control.automationPaused ? 'paused' : agentActivity.state(item.name),
  })) };
}
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
let desktopRevision = 0;
async function runAgent(action, workspace = 'shared', physical = false) {
  try {
    return await control.run(async () => {
      const finishActivity = agentActivity.begin(workspace);
      if (physical) desktopRevision++;
      try {
        await persistControl();
        return await action();
      }
      finally {
        // Restore the watched OS workspace before releasing the desktop gate.
        // Other agents' physical actions never replace the spectator's stream.
        try {
          if (physical && control.viewerOpen && control.mode !== 'human') await computer('workspace_select', { name: control.viewedWorkspace });
        } finally { if (physical) desktopRevision++; finishActivity(); }
      }
    }, workspace, physical);
  } finally { await persistControl(); }
}
await persistControl();
let transitions = Promise.resolve();
function changeControl(action) {
  const next = transitions.then(async () => {
    desktopRevision++;
    let status;
    try { status = await action(); } finally { desktopRevision++; }
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
  const issues = probes.flatMap((r, i) => r.status === 'rejected' ? [i === 0 ? 'Browser control is unavailable. Open igor.computer setup and retry.' : 'Browser display is unavailable. Open igor.computer setup and retry.'] : []);
  return healthCache = { ready: issues.length === 0, issues, checkedAt: Date.now() };
}
async function getStatus() {
  let native;
  try { native = JSON.parse(await readFile(join(stateDir, 'app-status.json'), 'utf8')); } catch {}
  const setup = nativeReadiness(nativeClientStatus || native);
  const lifecycle = runtimeManager.status();
  const runtime = lifecycle.state === 'awake' ? { ...lifecycle, ...await browserHealth() } : lifecycle;
  return { ...control.status(), appearance: appearance.value, setup, runtime, ...(control.mode === 'pending' ? { delivery: setup.notifications ? 'notification' : 'viewer', viewer: origin + '/viewer' } : {}) };
}
async function requireBrowser() {
  await runtimeInitialization;
  if (runtimeManager.state !== 'awake') appearance.appliedDark = undefined;
  await runtimeManager.ready();
  healthCache = null;
  const health = await browserHealth();
  if (!health.ready) throw new Error(health.issues.join(' '));
  await appearance.ensure();
}
const upstream = new Client({ name: 'igor-computer-service', version: '0.2.0' });
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
  const client = new Client({ name: 'igor-computer-' + workspace, version: '0.2.0' });
  browserClients.set(workspace, client);
  try { await client.connect(new StdioClientTransport(transportOptions)); }
  catch (error) { browserClients.delete(workspace); throw error; }
  return client;
}
const workspaceBrowsers = new BrowserWorkspaces(computer, browserWindows, async (workspace, state, client) => {
  const target = await watch.target(state, workspace);
  if (!target || target.blank) return;
  const pages = await client.callTool({ name: 'list_pages', arguments: {} });
  const text = pages.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
  const matches = [...text.matchAll(/^(\d+):\s+(.*?)(?:\s+\[selected\])?$/gm)].filter(item => item[2] === target.url || item[2].endsWith(' (' + target.url + ')'));
  if (matches.length === 1) return Number(matches[0][1]);
}, (name, state, context) => watch.openBackground(computer, name, state, context));
let nativeClientStatus;
const tools = (await upstream.listTools()).tools;
const computerUse = new ComputerUse();
const uiTools = desktopTools(JSON.parse(await readFile(join(base, 'computer-use-tools.json'), 'utf8')));
const allTools = [...tools, ...computerTools, ...uiTools];
const viewer = await readFile(join(base, 'viewer.html'));
const chromiumIcon = await readFile(join(base, 'assets/chromium.png'));
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
  const cookie = /(?:^|;\s*)igor_computer=([^;]+)/.exec(req.headers.cookie || '')?.[1];
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
    if (Buffer.byteLength(data) > (['/workspace-profile', '/workspace-sync'].includes(req.url) ? 16 : 1) * 1024 * 1024) throw new Error('Request too large.');
  }
  return data ? JSON.parse(data) : {};
}
function disconnectViewer() {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
}
async function openWatch(name) {
  await requireBrowser();
  await changeControl(async () => {
    const deadline = Date.now() + 120000;
    while (control.isBusy(name) || control.humanBusy) {
      if (Date.now() > deadline) throw new Error('Current desktop action is still finishing. Retry shortly.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    control.humanBusy = true;
    try {
      const state = await computer('workspace_list');
      if (!state.workspaces.some(item => item.name === name)) throw new Error('Unknown workspace.');
      disconnectViewer();
      await computer('workspace_select', { name });
    } finally { control.humanBusy = false; }
    control.watch(name);
    if (name === 'shared') return control.takeControl(name);
    return control.status();
  });
}
async function dispatch(path, args, signal, workspace = 'shared', label = workspace) {
  if (path === '/status') return getStatus();
  if (path === '/tools') return { tools: allTools };
  if (path === '/request-human') {
    await requireBrowser();
    if (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 300) throw new Error('Provide a short human-help message.');
    if (args.pageId !== undefined) {
      if (!Number.isInteger(args.pageId)) throw new Error('Invalid page ID.');
      await runAgent(async () => (await browserClient(workspace)).callTool({ name: 'select_page', arguments: { pageId: args.pageId } }), workspace);
    }
    await changeControl(() => control.requestHuman(args.message.trim(), args.pageId, workspace));
    return getStatus();
  }
  if (path === '/computer-use') {
    if (!uiTools.some(tool => tool.name === args.name)) throw new Error('Unknown desktop tool.');
    return runAgent(async () => {
      await requireBrowser();
      await computer('workspace_create', { name: workspace, ...(label !== workspace ? { label } : {}) });
      const state = await computer('workspace_select', { name: workspace });
      const schema = uiTools.find(tool => tool.name === args.name).inputSchema;
      const request = desktopRequest(args, schema, state, workspace);
      if (args.name === 'computer_ui_get_app_state' && request.arguments.window_id != null) {
        await browserWindows('focus', { id: state.windows.find(window => parseInt(window.id, 16) === request.arguments.window_id).id, generation: state.generation });
      }
      recordActivity(workspace, args.name, request.arguments, { space: 'desktop' });
      return computerUse.call(workspace, state.generation, request, signal);
    }, workspace, true);
  }
  if (path === '/computer') {
    const { name, arguments: parameters = {} } = args;
    if (!computerTools.some(tool => tool.name === name)) throw new Error('Unknown computer tool.');
    if (name === 'computer_end_turn') return runtimeManager.endTurn(parameters.turnId);
    if (name === 'computer_begin_turn') return runAgent(async () => { await requireBrowser(); return runtimeManager.beginTurn(parameters.turnId); }, workspace);
    if (name === 'computer_sleep') { await runtimeInitialization; return runtimeManager.sleep(control); }
    return runAgent(async () => {
      await requireBrowser();
      if (name === 'computer_wake') return runtimeManager.status();
      if (['computer_input', 'computer_screenshot'].includes(name)) { await computer('workspace_create', { name: workspace, ...(label !== workspace ? { label } : {}) }); await computer('workspace_select', { name: workspace }); }
      const action = name === 'computer_workspace' ? 'workspace_' + parameters.action : name.slice('computer_'.length);
      recordActivity(workspace, name, parameters, { space: 'desktop' });
      return computer(action, parameters);
    }, workspace, ['computer_input', 'computer_screenshot'].includes(name) || (name === 'computer_workspace' && parameters.action !== 'list'));
  }
  if (path === '/call') {
    // Set the busy gate before waking, so takeover cannot race restoration.
    return runAgent(async () => {
      await requireBrowser();
      if (!tools.some(tool => tool.name === args.name)) throw new Error('Unknown browser tool.');
      const client = await browserClient(workspace);
      const recovery = args.name === 'close_page' ? undefined : await workspaceBrowsers.ensure(workspace, label, client, args.name, args.arguments?.isolatedContext);
      let point = {};
      if (['click', 'fill', 'hover', 'drag'].includes(args.name) && typeof args.arguments?.uid === 'string') {
        try {
          const measured = await client.callTool({ name: 'evaluate_script', arguments: {
            function: '(el) => { const r=el.getBoundingClientRect(); return {x:screenX+(outerWidth-innerWidth)/2+r.x+r.width/2,y:screenY+outerHeight-innerHeight+r.y+r.height/2}; }',
            args: [args.arguments.uid], waitForStableDom: false,
            ...(args.arguments.pageId !== undefined ? { pageId: args.arguments.pageId } : {}),
          } }, undefined, { timeout: 2000, signal });
          const text = measured.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
          const json = /\{[^{}]*"x"[^{}]*\}/.exec(text);
          if (json) point = JSON.parse(json[0]);
        } catch { /* Activity hints must never block browser actions. */ }
      }
      recordActivity(workspace, args.name, { ...args.arguments, ...point }, { space: 'desktop' });
      // Selecting a CDP page must not activate the shared physical desktop.
      const request = recoveredRequest({ ...args, arguments: { ...args.arguments, ...(args.name === 'select_page' ? { bringToFront: false } : {}) } }, recovery);
      const result = await client.callTool(request, undefined, { timeout: 120000, signal });
      if (!result.isError) recordActivity(workspace, args.name, { ...args.arguments, ...point }, { space: 'desktop' });
      return result;
    }, workspace, args.name === 'new_page' && args.arguments?.isolatedContext !== undefined);
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
    if (path === '/assets/chromium.png' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(chromiumIcon);
    }
    if (!authorized(req)) return json(res, { error: 'Unauthorized.' }, 401);
    if (path === '/session' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `igor_computer=${token}; HttpOnly; SameSite=Strict; Path=/${origin.startsWith('https:') ? '; Secure' : ''}`);
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
      if (!control.viewerOpen) throw new Error('Open the viewer first.');
      await requireBrowser();
      return json(res, await viewedState());
    }
    if (path === '/appearance' && req.method === 'GET') return json(res, appearance.value);
    if (path === '/apps' && req.method === 'GET') {
      if (!control.viewerOpen) throw new Error('Open the viewer first.');
      return json(res, await desktop.catalog());
    }
    if (path === '/watch-frame' && req.method === 'GET') {
      if (!control.viewerOpen || control.mode === 'human') throw new Error('Open watch mode first.');
      await requireBrowser();
      const name = control.viewedWorkspace;
      const state = await viewedState();
      const revision = desktopRevision;
      const frame = await desktopView.frame(state, name, () => revision === desktopRevision && name === control.viewedWorkspace && control.mode !== 'human');
      const profile = state.workspaces.find(item => item.name === name);
      const action = activities.get(name);
      return json(res, { ...frame, profile, activity: action && Date.now() - action.at < 2500 ? action : null });
    }
    if (path === '/tools' && req.method === 'GET') return json(res, { tools: allTools });
    if (req.method !== 'POST') return json(res, { error: 'Not found.' }, 404);
    const args = await body(req);
    if (path === '/workspace-sync') {
      await requireBrowser();
      const result = await changeControl(async () => {
        if (control.busy || control.humanBusy) throw new Error('Current desktop action is still finishing. Retry shortly.');
        const previous = (await desktop.preferences()).rosters?.[args.owner] || [];
        if (control.mode === 'human' && previous.includes(control.humanWorkspace) && !args.profiles?.some(profile => profile.id === control.humanWorkspace)) throw new Error('Finish control of the removed agent workspace before syncing.');
        control.humanBusy = true;
        let result;
        try { result = await desktop.reconcile(args.owner, args.profiles); }
        finally { control.humanBusy = false; }
        for (const name of result.removed) {
          await browserClients.get(name)?.close();
          browserClients.delete(name);
          workspaceBrowsers.prepared.delete(name);
          desktopView.frames.delete(name);
          activities.delete(name);
        }
        if (result.removed.includes(control.viewedWorkspace)) {
          control.viewedWorkspace = 'shared';
          if (control.viewerOpen) {
            await computer('workspace_select', { name: 'shared' });
            control.watch('shared');
            control.takeControl('shared');
          }
        }
        return { ok: true };
      });
      return json(res, result);
    }
    if (path === '/workspace-profile') return json(res, await desktop.profile(workspace, args));
    if (path === '/apps') {
      if (args.action === 'pin' && control.viewerOpen) return json(res, await desktop.pin(args.pins));
      return json(res, await control.runHuman(() => args.action === 'launch' ? desktop.launch(args.id, args.newWindow === true) : Promise.reject(new Error('Unknown app action.'))));
    }
    if (path === '/workspaces') {
      if (!['select', 'open_browser'].includes(args.action)) throw new Error('Unknown workspace action.');
      if (args.action === 'select') {
        await openWatch(args.name);
        return json(res, await viewedState());
      }
      return json(res, await control.runHuman(async () => {
        if (args.action === 'open_browser' && !args.name) args.name = control.humanWorkspace;
        if (args.name && args.name !== control.humanWorkspace) throw new Error('Take control of this workspace first.');
        const result = await computer('workspace_' + args.action, args);
        return result;
      }));
    }
    if (path === '/watch') {
      await openWatch(args.name || (control.mode === 'pending' ? control.request?.workspace : null) || control.viewedWorkspace);
      return json(res, control.status());
    }
    if (path === '/release-control') {
      if (control.mode !== 'human') throw new Error('Take control before returning it.');
      const status = await changeControl(() => control.release());
      disconnectViewer();
      return json(res, status);
    }
    if (path === '/appearance') { await requireBrowser(); return json(res, await appearance.set(args.mode, args.hostDark)); }
    if (path === '/client-status') { nativeClientStatus = { ...args, checkedAt: Date.now() }; return json(res, { ok: true }); }
    if (path === '/computer-use') return json(res, await dispatch(path, args, undefined, workspace, label));
    if (path === '/computer') return json(res, await dispatch('/computer', args, undefined, workspace, label));
    if (path === '/request-human') return json(res, await dispatch(path, args, undefined, workspace, label));
    if (path === '/windows' && req.method === 'POST') {
      if (control.mode !== 'human') throw new Error('Take control to manage windows.');
      const state = await viewedState();
      const selected = state.workspaces.find(item => item.active);
      if (args.id && !state.windows.some(item => item.id === args.id && item.desktop === selected.desktop)) throw new Error('Window is outside controlled workspace.');
      return json(res, await control.runHuman(() => browserWindows(args.action, args)));
    }
    if (path === '/take-control') {
      const name = args.name || (control.mode === 'pending' ? control.request?.workspace : null) || control.viewedWorkspace;
      const available = await computer('workspace_list');
      if (!available.workspaces.some(item => item.name === name)) throw new Error('Unknown workspace.');
      await changeControl(async () => {
        control.takeoverWaiting = name;
        try {
          const deadline = Date.now() + 120000;
          while (control.isBusy(name)) {
            if (Date.now() > deadline) throw new Error('Current action is still finishing. Retry shortly.');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return control.takeControl(name);
        } finally { control.takeoverWaiting = null; }
      });
      control.humanBusy = true;
      try {
        await requireBrowser();
        if (await computerBusy()) throw new Error('Finishing an interrupted computer command. Retry shortly.');
        await computer('workspace_select', { name: control.humanWorkspace });
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
server.listen(port, host, () => console.error(`igor.computer server ready at ${origin}`));
// HTTP status remains available during startup, sleep and recovery failures.
const runtimeInitialization = runtimeManager.recoverState().catch(error => { runtimeManager.state = 'error'; runtimeManager.error = error.message; console.error('VM startup:', error.message); });
const idleTimer = setInterval(() => { void runtimeManager.idle(control).catch(error => console.error('VM sleep:', error.message)); }, 5000);
idleTimer.unref();
async function close() {
  clearInterval(idleTimer);
  disconnectViewer();
  server.close();
  for (const mcp of mcpConnections) await mcp.close();
  watch.close();
  await computerUse.close();
  for (const client of browserClients.values()) await client.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
