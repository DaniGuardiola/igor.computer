import { AppliedAppearance, applyGuestAppearance } from './appearance.mjs';
import { AgentActivity } from './agent-activity.mjs';
import { DesktopView } from './desktop-view.mjs';
import { Watch, activity } from './watch.mjs';
import { Desktop } from './desktop.mjs';
import { Runtime } from './runtime.mjs';
import { Guest } from './guest.mjs';
import { computerTools } from './computer-tools.mjs';
import { createMcpServer } from './mcp-server.mjs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BrowserWorkspaces, recoveredRequest } from './browser-workspace.mjs';
import { ComputerUse, desktopTools, desktopRequest } from './computer-use.mjs';
import { Providers } from './providers.mjs';
import { Control } from './control.mjs';
import { container } from './guest.mjs';

const base = dirname(fileURLToPath(import.meta.url));
const devtools = join(base, '../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js');
const uiTools = desktopTools(JSON.parse(await readFile(join(base, 'computer-use-tools.json'), 'utf8')));

// The DevTools tool list is fixed by the pinned package; read it once without a browser.
export async function devtoolsTools() {
  const client = new Client({ name: 'igor-computer-catalog', version: '0.2.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [devtools, '--browser-url=http://127.0.0.1:9', '--no-usage-statistics', '--no-performance-crux'], stderr: 'ignore' }));
  try { return (await client.listTools()).tools; } finally { await client.close(); }
}

export function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
export async function body(req, limit = 1) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > limit * 1024 * 1024) throw new Error('Request too large.');
  }
  return data ? JSON.parse(data) : {};
}

// One computer: its VM lifecycle, ownership gate, workspaces, viewer and tools.
// The HTTP server routes /computers/<name>/* (and, for the default computer, /*) here.
export async function createComputer({ context, appearance, browserTools, setupStatus, viewerUrl }) {
  await mkdir(context.dir, { recursive: true, mode: 0o700 });
  const guest = new Guest(context);
  const computer = (action, args) => guest.computer(action, args);
  const runtimeManager = new Runtime(context, guest);
  const applied = new AppliedAppearance(appearance, dark => applyGuestAppearance(computer, dark));
  const desktop = new Desktop(context.dir, { computer });
  const control = new Control();
  const watch = new Watch(context.cdpUrl);
  const desktopView = new DesktopView(computer);
  const providers = new Providers(context);
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
  const controlFile = join(context.dir, 'control.json');
  try {
    const previous = JSON.parse(await readFile(controlFile, 'utf8'));
    // Open help requests survive restarts; they never held anything up.
    control.requests = Array.isArray(previous.requests) ? previous.requests : [];
    control.automationPaused = previous.automationPaused === true;
    if (previous.mode !== 'agent' || previous.busy || previous.humanBusy) {
      control.mode = 'paused';
      control.automationPaused = true;
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
  async function computerHealth() {
    if (healthCache && Date.now() - healthCache.checkedAt < 2000) return healthCache;
    const probes = await Promise.allSettled([runtimeManager.browser ? guest.browserHealth() : Promise.resolve(), guest.displayHealth()]);
    const issues = probes.flatMap((r, i) => r.status === 'rejected' ? [i === 0 ? 'Browser control is unavailable. Open igor.computer setup and retry.' : 'Computer display is unavailable. Open igor.computer setup and retry.'] : []);
    return healthCache = { ready: issues.length === 0, issues, checkedAt: Date.now() };
  }
  async function getStatus() {
    const setup = await setupStatus();
    const lifecycle = runtimeManager.status();
    const runtime = lifecycle.state === 'awake' ? { ...lifecycle, ...await computerHealth(), issues: [...lifecycle.issues, ...(await computerHealth()).issues] } : lifecycle;
    return { computer: context.name, ...control.status(), appearance: appearance.value, setup, runtime, ...(control.status().request ? { delivery: setup.notifications ? 'notification' : 'viewer', viewer: viewerUrl } : {}) };
  }
  let initialization;
  async function requireComputer() {
    await initialization;
    if (runtimeManager.state !== 'awake') applied.reset();
    const wasAwake = runtimeManager.state === 'awake';
    await runtimeManager.ready();
    if (!wasAwake) await providers.close();
    healthCache = null;
    const health = await computerHealth();
    if (!health.ready) throw new Error(health.issues.join(' '));
    await applied.ensure();
  }
  function requireBrowserCapability() {
    if (!runtimeManager.browser) throw new Error(`Computer ${context.name} has no browser. Enable it in the computer definition.`);
  }
  const transportOptions = {
    command: process.execPath,
    args: [devtools, '--browser-url=' + context.cdpUrl, '--no-usage-statistics', '--no-performance-crux'],
    stderr: 'inherit',
  };
  // DevTools clients start on a workspace's first browser command, not at server start.
  const browserClients = new Map();
  async function browserClient(workspace) {
    if (browserClients.has(workspace)) return browserClients.get(workspace);
    if (browserClients.size >= 32) throw new Error('Maximum 32 browser client workspaces.');
    const client = new Client({ name: 'igor-computer-' + workspace, version: '0.2.0' });
    const connecting = client.connect(new StdioClientTransport(transportOptions)).then(() => client);
    browserClients.set(workspace, connecting);
    try { return await connecting; }
    catch (error) { browserClients.delete(workspace); throw error; }
  }
  const workspaceBrowsers = new BrowserWorkspaces(computer, null, async (workspace, state, client) => {
    const target = await watch.target(state, workspace);
    if (!target || target.blank) return;
    const pages = await client.callTool({ name: 'list_pages', arguments: {} });
    const text = pages.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
    const matches = [...text.matchAll(/^(\d+):\s+(.*?)(?:\s+\[selected\])?$/gm)].filter(item => item[2] === target.url || item[2].endsWith(' (' + target.url + ')'));
    if (matches.length === 1) return Number(matches[0][1]);
  }, (name, state, context) => watch.openBackground(computer, name, state, context));
  const computerUse = new ComputerUse(async workspace => {
    const client = new Client({ name: 'igor-computer-' + workspace, version: '0.2.0' });
    await client.connect(new StdioClientTransport({
      command: 'docker', args: ['exec', '-i', container, ...guest.manifest.desktopTools], env: context.env, stderr: 'inherit',
    }));
    return client;
  });
  async function tools() {
    const manifest = guest.manifest;
    let provided = await providers.tools(manifest);
    // A new MCP server list is read once from the guest, waking it if needed.
    if (provided === null) { await requireComputer(); provided = await providers.tools(guest.manifest, { refresh: true }); }
    return [...(runtimeManager.browser ? browserTools : []), ...computerTools, ...(manifest.desktopTools ? uiTools : []), ...provided];
  }
  const sockets = new Set();
  const proxy = httpProxy.createProxyServer({ target: context.displayUrl, ws: true });
  proxy.on('error', (_error, _req, res) => {
    if (res?.writeHead && !res.headersSent) { res.writeHead(502); res.end('Computer display unavailable.'); }
    else res?.destroy?.();
  });
  function disconnectViewer() {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  }
  async function openWatch(name) {
    await requireComputer();
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
    if (path === '/tools') return { tools: await tools() };
    if (path === '/request-human') {
      if (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 300) throw new Error('Provide a short human-help message.');
      if (args.pageId !== undefined) {
        await requireComputer();
        requireBrowserCapability();
        if (!Number.isInteger(args.pageId)) throw new Error('Invalid page ID.');
        await runAgent(async () => (await browserClient(workspace)).callTool({ name: 'select_page', arguments: { pageId: args.pageId } }), workspace);
      }
      const request = await changeControl(() => control.requestHuman(args.message.trim(), args.pageId, workspace));
      return { ...await getStatus(), request };
    }
    if (path === '/withdraw-request') return { request: await changeControl(() => control.withdraw(args.requestId, workspace)) };
    if (path === '/computer-use') {
      if (!uiTools.some(tool => tool.name === args.name)) throw new Error('Unknown desktop tool.');
      return runAgent(async () => {
        await requireComputer();
        if (!guest.manifest.desktopTools) throw new Error('This computer does not provide desktop accessibility tools.');
        await computer('workspace_create', { name: workspace, ...(label !== workspace ? { label } : {}) });
        const state = await computer('workspace_select', { name: workspace });
        const schema = uiTools.find(tool => tool.name === args.name).inputSchema;
        const request = desktopRequest(args, schema, state, workspace);
        if (args.name === 'computer_ui_get_app_state' && request.arguments.window_id != null) {
          await guest.windows('focus', { id: state.windows.find(window => parseInt(window.id, 16) === request.arguments.window_id).id, generation: state.generation });
        }
        recordActivity(workspace, args.name, request.arguments, { space: 'desktop' });
        return computerUse.call(workspace, state.generation, request, signal);
      }, workspace, true);
    }
    if (path === '/computer') {
      const { name, arguments: parameters = {} } = args;
      if (!computerTools.some(tool => tool.name === name)) throw new Error('Unknown computer tool.');
      if (name === 'computer_end_turn') return runtimeManager.endTurn(parameters.turnId);
      if (name === 'computer_begin_turn') return runAgent(async () => { await requireComputer(); return runtimeManager.beginTurn(parameters.turnId); }, workspace);
      if (name === 'computer_sleep') { await initialization; return runtimeManager.sleep(control); }
      return runAgent(async () => {
        await requireComputer();
        if (name === 'computer_wake') return runtimeManager.status();
        if (['computer_input', 'computer_screenshot'].includes(name)) { await computer('workspace_create', { name: workspace, ...(label !== workspace ? { label } : {}) }); await computer('workspace_select', { name: workspace }); }
        const action = name === 'computer_workspace' ? 'workspace_' + parameters.action : name.slice('computer_'.length);
        recordActivity(workspace, name, parameters, { space: 'desktop' });
        return computer(action, parameters);
      }, workspace, ['computer_input', 'computer_screenshot'].includes(name) || (name === 'computer_workspace' && parameters.action !== 'list'));
    }
    if (path === '/call') {
      if (providers.owns(guest.manifest, args.name)) {
        return runAgent(async () => {
          await requireComputer();
          recordActivity(workspace, args.name, args.arguments || {}, { space: 'tool' });
          return providers.call(guest.manifest, args, signal);
        }, workspace);
      }
      // Set the busy gate before waking, so takeover cannot race restoration.
      return runAgent(async () => {
        await requireComputer();
        requireBrowserCapability();
        if (!browserTools.some(tool => tool.name === args.name)) throw new Error('Unknown tool.');
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
  // Handles one computer-scoped request. path is relative to the computer.
  async function handle(req, res, path, { workspace, label }) {
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
      req.headers.authorization = await guest.displayAuthorization();
      delete req.headers.cookie;
      req.url = path.slice(4);
      return proxy.web(req, res);
    }
    if (path === '/status' && req.method === 'GET') return json(res, await getStatus());
    if (path === '/workspaces' && req.method === 'GET') {
      if (!control.viewerOpen) throw new Error('Open the viewer first.');
      await requireComputer();
      return json(res, await viewedState());
    }
    if (path === '/apps' && req.method === 'GET') {
      if (!control.viewerOpen) throw new Error('Open the viewer first.');
      return json(res, await desktop.catalog());
    }
    if (path === '/watch-frame' && req.method === 'GET') {
      if (!control.viewerOpen || control.mode === 'human') throw new Error('Open watch mode first.');
      await requireComputer();
      const name = control.viewedWorkspace;
      const state = await viewedState();
      const revision = desktopRevision;
      const frame = await desktopView.frame(state, name, () => revision === desktopRevision && name === control.viewedWorkspace && control.mode !== 'human');
      const profile = state.workspaces.find(item => item.name === name);
      const action = activities.get(name);
      return json(res, { ...frame, profile, activity: action && Date.now() - action.at < 2500 ? action : null });
    }
    if (path === '/tools' && req.method === 'GET') return json(res, await dispatch('/tools'));
    if (req.method !== 'POST') return json(res, { error: 'Not found.' }, 404);
    const args = await body(req, path === '/workspace-sync' ? 16 : 1);
    if (path === '/workspace-sync') {
      // Roster changes made while asleep apply on wake; never wake just to sync.
      if (runtimeManager.state !== 'awake') { pendingRoster = args; return json(res, { ok: true, deferred: true }); }
      return json(res, await syncRoster(args));
    }
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
        return computer('workspace_' + args.action, args);
      }));
    }
    if (path === '/watch') {
      await openWatch(args.name || control.status().request?.workspace || control.viewedWorkspace);
      return json(res, control.status());
    }
    if (path === '/release-control') {
      if (control.mode !== 'human') throw new Error('Take control before returning it.');
      const status = await changeControl(() => control.release());
      disconnectViewer();
      return json(res, status);
    }
    if (['/computer-use', '/computer', '/request-human', '/withdraw-request', '/call'].includes(path)) return json(res, await dispatch(path, args, undefined, workspace, label));
    if (path === '/windows') {
      if (control.mode !== 'human') throw new Error('Take control to manage windows.');
      const state = await viewedState();
      const selected = state.workspaces.find(item => item.active);
      if (args.id && !state.windows.some(item => item.id === args.id && item.desktop === selected.desktop)) throw new Error('Window is outside controlled workspace.');
      return json(res, await control.runHuman(() => guest.windows(args.action, args)));
    }
    if (path === '/take-control') {
      const name = args.name || control.status().request?.workspace || control.viewedWorkspace;
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
        await requireComputer();
        if (await guest.busy()) throw new Error('Finishing an interrupted computer command. Retry shortly.');
        await computer('workspace_select', { name: control.humanWorkspace });
      } catch (error) {
        control.mode = 'paused'; control.automationPaused = true;
        throw error;
      } finally { control.humanBusy = false; await persistControl(); }
      return json(res, control.status());
    }
    if (path === '/automation-pause') return json(res, await changeControl(() => control.setAutomationPaused(args.paused)));
    if (path === '/close-viewer') return json(res, await changeControl(() => { const status = control.closeViewer(); runtimeManager.lastUsed = Date.now(); disconnectViewer(); return status; }));
    if (path === '/pause') return json(res, await changeControl(() => control.pause()));
    if (path === '/resume') return json(res, await changeControl(() => { const status = control.resume(); disconnectViewer(); return status; }));
    if (path === '/dismiss-request') return json(res, { request: await changeControl(() => control.dismiss(args.id)) });
    if (path === '/rebuild') {
      await initialization;
      disconnectViewer();
      await providers.close();
      await computerUse.close();
      const status = await runtimeManager.rebuild(control);
      applied.reset();
      return json(res, status);
    }
    return json(res, { error: 'Not found.' }, 404);
  }

  let pendingRoster;
  async function syncRoster(args) {
    await requireComputer();
    return changeControl(async () => {
      if (control.busy || control.humanBusy) throw new Error('Current desktop action is still finishing. Retry shortly.');
      const previous = (await desktop.preferences()).rosters?.[args.owner] || [];
      if (control.mode === 'human' && previous.includes(control.humanWorkspace) && !args.profiles?.some(profile => profile.id === control.humanWorkspace)) throw new Error('Finish control of the removed agent workspace before syncing.');
      control.humanBusy = true;
      let result;
      try { result = await desktop.reconcile(args.owner, args.profiles); }
      finally { control.humanBusy = false; }
      for (const name of result.removed) {
        await (await browserClients.get(name)?.catch(() => null))?.close();
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
  }

  // Interactive display: only the person in control gets an input-capable connection.
  async function upgrade(req, socket, head, path) {
    if ((control.mode !== 'human' || control.humanBusy) || path !== '/vnc/websockify') return socket.destroy();
    try {
      req.headers.authorization = await guest.displayAuthorization();
      delete req.headers.cookie;
      // Ownership may change while reading the backend credential.
      if (control.mode !== 'human' || control.humanBusy || socket.destroyed) return socket.destroy();
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      req.url = '/websockify';
      proxy.ws(req, socket, head);
    } catch { socket.destroy(); }
  }

  async function idle() {
    await runtimeManager.idle(control);
    if (pendingRoster && runtimeManager.state === 'awake' && !control.busy && !control.humanBusy) {
      const roster = pendingRoster; pendingRoster = null;
      await syncRoster(roster).catch(error => { pendingRoster ??= roster; throw error; });
    }
  }
  function start({ autostart = false } = {}) {
    // HTTP status remains available during startup, sleep and recovery failures.
    initialization = runtimeManager.recoverState({ autostart }).catch(error => { runtimeManager.state = 'error'; runtimeManager.error = error.message; console.error(`[${context.name}] startup:`, error.message); });
    return initialization;
  }
  async function summary() {
    const lifecycle = runtimeManager.status();
    return { name: context.name, source: context.source, state: lifecycle.state, issues: lifecycle.issues, mode: control.mode, request: control.status().request, openRequests: control.openRequests().length, viewerOpen: control.viewerOpen,
      // Before the first build, report what the definition asks for.
      ...(runtimeManager.state === 'awake' ? { browser: runtimeManager.browser, mcp: Object.keys(guest.manifest.mcp || {}) }
        : { browser: runtimeManager.definition?.definition.browser ?? true, mcp: Object.keys(runtimeManager.definition?.definition.mcp ?? guest.manifest.mcp ?? {}) }),
      activeTurns: lifecycle.activeTurns };
  }
  async function close() {
    disconnectViewer();
    for (const mcp of mcpConnections) await mcp.close();
    watch.close();
    await computerUse.close();
    await providers.close();
    for (const client of browserClients.values()) await (await client.catch(() => null))?.close();
  }
  return { context, handle, upgrade, idle, start, summary, close, getStatus, control, runtime: runtimeManager,
    applyAppearance: () => runtimeManager.state === 'awake' ? applied.ensure() : undefined,
    busy: () => control.busy || control.mode === 'human' || runtimeManager.turns.size > 0 };
}
