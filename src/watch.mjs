import WebSocket from 'ws';

// Resolve existing Chromium window identity through a read-only CDP connection.
// Lookup never selects a tab or activates an OS workspace.
export class Watch {
  constructor(endpoint = 'http://127.0.0.1:18422') {
    this.endpoint = endpoint;
    this.sequence = 0;
    this.pending = new Map();
    this.windows = new Map();
  }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const response = await fetch(this.endpoint + '/json/version', { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Browser preview unavailable.');
      const { webSocketDebuggerUrl } = await response.json();
      const socket = new WebSocket(webSocketDebuggerUrl);
      this.socket = socket;
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.on('message', data => {
        const result = JSON.parse(data);
        const request = this.pending.get(result.id);
        if (!request) return;
        this.pending.delete(result.id);
        clearTimeout(request.timer);
        if (result.error) request.reject(new Error(result.error.message)); else request.resolve(result.result);
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser connection disconnected.')); }
        this.pending.clear();
        this.windows.clear();
      });
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async call(method, params = {}, sessionId) {
    await this.connect();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Browser connection timed out.')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  // Chromium's CDP window IDs differ from X11 IDs. Resolve them once by their
  // visible tab titles, then retain that identity across navigation and renames.
  // Never guess across distinct windows with the same title.
  async target(state, workspace, windowId) {
    if (this.generation !== state.generation) { this.windows.clear(); this.generation = state.generation; }
    const desktop = state.workspaces.find(item => item.name === workspace)?.desktop;
    const entries = state.windows.filter(item => item.desktop === desktop && /chromium/i.test(item.app));
    const entry = windowId ? entries.find(item => item.id === windowId) : entries.find(item => item.active) || entries[0];
    if (!entry) return null;
    const { targetInfos } = await this.call('Target.getTargets');
    const pages = targetInfos.filter(item => item.type === 'page');
    const grouped = new Map();
    for (const page of pages) {
      const { windowId: browserId } = await this.call('Browser.getWindowForTarget', { targetId: page.targetId });
      if (!grouped.has(browserId)) grouped.set(browserId, []);
      grouped.get(browserId).push(page);
    }
    let browserId = this.windows.get(entry.id);
    if (!grouped.has(browserId)) {
      const title = entry.title.replace(/ - Chromium$/, '');
      const candidates = [...grouped].filter(([, tabs]) => tabs.some(tab => tab.title === title || (title === 'about:blank' && tab.url === 'about:blank')));
      if (candidates.length === 1) browserId = candidates[0][0];
      else {
        // Identical empty windows have identical previews; no page content can
        // cross workspace boundaries. Delay identity caching until distinguishable.
        const blank = candidates.length && candidates.every(([, tabs]) => tabs.every(tab => tab.url === 'about:blank'));
        if (blank) return { ...candidates[0][1][0], window: entry, blank: true };
        throw new Error('Browser window identity is ambiguous.');
      }
      this.windows.set(entry.id, browserId);
    }
    const tabs = grouped.get(browserId);
    const visible = tabs.filter(tab => tab.title === entry.title.replace(/ - Chromium$/, '') || (entry.title === 'about:blank - Chromium' && tab.url === 'about:blank'));
    return { ...(visible[0] || tabs[0]), window: entry };
  }
  close() { this.socket?.close(); }
}

// Only safe action metadata reaches viewers. Never retain text, scripts, URLs,
// selectors, file content or credentials in an activity event.
export function activity(name, args = {}) {
  let kind;
  if (/type_text|fill|type$/.test(name) || args.kind === 'type') kind = 'typing';
  else if (/press_key/.test(name) || args.kind === 'key') kind = 'shortcut';
  else if (/click/.test(name) || args.kind === 'click') kind = 'click';
  else if (/hover/.test(name)) kind = 'pointer';
  else if (/drag/.test(name)) kind = 'drag';
  else if (/scroll/.test(name) || args.kind === 'scroll') kind = 'scroll';
  else if (/navigate|new_page|select_page/.test(name)) kind = 'browsing';
  else if (/perform_action/.test(name)) kind = 'action';
  if (!kind) return null;
  const value = { kind };
  if (Number.isFinite(args.x) && Number.isFinite(args.y)) { value.x = args.x; value.y = args.y; }
  if (Number.isFinite(args.end_x) && Number.isFinite(args.end_y)) { value.x = args.end_x; value.y = args.end_y; }
  const key = args.key || args.keys;
  if (kind === 'shortcut' && typeof key === 'string' && key.length <= 80 && /^(?:(?:ctrl|control|alt|shift|super|meta|cmd|command|option)\+)+(?:[a-z0-9]|Return|Enter|Escape|Esc|Tab|BackSpace|Delete|Del|Space|Home|End|PageUp|PageDown|Left|Right|Up|Down|F\d{1,2})$|^(?:Return|Enter|Escape|Esc|Tab|BackSpace|Delete|Del|Space|Home|End|PageUp|PageDown|Left|Right|Up|Down|F\d{1,2})$/i.test(key)) value.key = key;
  return value;
}
