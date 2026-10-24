// Keep window recovery inside the same ownership gate as the browser command.
export function pageIds(result) {
  const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  return [...text.matchAll(/^(\d+):/gm)].map(match => Number(match[1]));
}

export class BrowserWorkspaces {
  prepared = new Set();
  setup = Promise.resolve();
  constructor(computer, windows, resolvePage, openBackground) {
    this.computer = computer; this.resolvePage = resolvePage; this.openBackground = openBackground;
  }
  async ensure(name, label, client, tool, isolatedContext) {
    // Only workspace bookkeeping/window creation is serialized. Page actions
    // remain concurrent, with an independent selected page per agent client.
    const next = this.setup.then(() => this.prepare(name, label, client, tool, isolatedContext));
    this.setup = next.catch(() => {});
    return next;
  }
  async prepare(name, label, client, tool, isolatedContext) {
    const state = await this.computer('workspace_create', { name, ...(label !== name ? { label } : {}) });
    const desktop = state.workspaces.find(workspace => workspace.name === (name === 'user' ? 'shared' : name))?.desktop;
    const entries = state.windows.filter(window => window.desktop === desktop && /chromium/i.test(window.app));
    const call = (name, args = {}) => client.callTool({ name, arguments: args }, { timeout: 120000 });
    if (entries.length && !this.prepared.has(name) && this.resolvePage) {
      const pageId = await this.resolvePage(name, state, client).catch(() => undefined);
      if (pageId !== undefined) {
        const selected = await call('select_page', { pageId, bringToFront: false });
        if (!selected.isError) this.prepared.add(name);
      }
    }
    if (entries.length && this.prepared.has(name) && tool !== 'new_page') return;
    const opened = await this.openBackground(name, state, isolatedContext);
    const url = typeof opened === 'string' ? opened : opened.url;
    try {
      let pageId, currentIds;
      for (let attempt = 0; attempt < 50; attempt++) {
        const result = await call('list_pages');
        currentIds = pageIds(result);
        const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
        const match = [...text.matchAll(/^(\d+):\s+(.*?)(?:\s+\[selected\])?$/gm)].find(item => item[2] === url || item[2].endsWith(' (' + url + ')'));
        if (match) { pageId = Number(match[1]); break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (pageId === undefined) throw new Error('Background browser page is not ready. Retry shortly.');
      const selected = await call('select_page', { pageId, bringToFront: false });
      if (selected.isError) throw new Error('Could not select this workspace’s browser page.');
      await call('navigate_page', { pageId, type: 'url', url: 'about:blank' });
      this.prepared.add(name);
      return { pageId, currentIds };
    } catch (error) {
      await opened.close?.().catch(() => {});
      throw error;
    }
  }
}

export function recoveredRequest(request, recovery) {
  if (!recovery) return request;
  if (request.name === 'new_page') {
    return { name: 'navigate_page', arguments: { pageId: recovery.pageId, type: 'url', url: request.arguments.url, ...(request.arguments.timeout ? { timeout: request.arguments.timeout } : {}) } };
  }
  if (request.arguments?.pageId !== undefined && !recovery.currentIds.includes(request.arguments.pageId)) {
    return { ...request, arguments: { ...request.arguments, pageId: recovery.pageId } };
  }
  return request;
}
