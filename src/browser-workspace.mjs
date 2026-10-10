// Keep window recovery inside the same ownership gate as the browser command.
export function pageIds(result) {
  const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  return [...text.matchAll(/^(\d+):/gm)].map(match => Number(match[1]));
}

export class BrowserWorkspaces {
  prepared = new Set();
  constructor(computer, windows) { this.computer = computer; this.windows = windows; }
  async ensure(name, label, client, tool) {
    const state = await this.computer('workspace_create', { name, ...(label !== name ? { label } : {}) });
    const desktop = state.workspaces.find(workspace => workspace.name === (name === 'user' ? 'shared' : name))?.desktop;
    const entries = state.windows.filter(window => window.desktop === desktop && /chromium/i.test(window.app));
    const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    let recovery;
    if (!entries.length) {
      const before = new Set(pageIds(await call('list_pages')));
      await this.computer('workspace_open_browser', { name, reuse: true });
      // DevTools observes new targets asynchronously, including after browser restart.
      let pageId, currentIds;
      for (let attempt = 0; attempt < 30; attempt++) {
        currentIds = pageIds(await call('list_pages'));
        pageId = currentIds.find(id => !before.has(id));
        if (pageId !== undefined) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (pageId === undefined) throw new Error('Browser opened, but its page is not ready. Retry shortly.');
      const selected = await call('select_page', { pageId });
      if (selected.isError) throw new Error('Could not select the reopened browser page. Refresh list_pages.');
      this.prepared.add(name);
      recovery = { pageId, currentIds };
    } else if (!this.prepared.has(name)) {
      const entry = entries.find(window => window.active) || entries[0];
      await this.windows('focus', { id: entry.id, generation: state.generation });
      // Find the focused tab without changing titles, moving windows or touching Chrome.
      let focused;
      for (let attempt = 0; attempt < 10 && focused === undefined; attempt++) {
        for (const pageId of pageIds(await call('list_pages'))) {
          const result = await call('evaluate_script', { pageId, function: '() => ({igorWorkspaceFocused: document.hasFocus()})' });
          if (!result.isError && result.content?.some(item => /"igorWorkspaceFocused"\s*:\s*true/.test(item.text || ''))) {
            focused = pageId; break;
          }
        }
        if (focused === undefined) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (focused === undefined) throw new Error('Could not select this workspace’s browser tab. Retry shortly.');
      await call('select_page', { pageId: focused });
      this.prepared.add(name);
    }
    if (tool === 'new_page') {
      const current = await this.computer('workspace_list');
      const entry = current.windows.find(window => window.desktop === desktop && /chromium/i.test(window.app));
      if (entry) await this.windows('focus', { id: entry.id, generation: current.generation });
    }
    return recovery;
  }
}

export function recoveredRequest(request, recovery) {
  if (!recovery) return request;
  if (request.name === 'new_page' && request.arguments?.isolatedContext === undefined) {
    return { name: 'navigate_page', arguments: { pageId: recovery.pageId, type: 'url', url: request.arguments.url, ...(request.arguments.timeout ? { timeout: request.arguments.timeout } : {}) } };
  }
  if (request.arguments?.pageId !== undefined && !recovery.currentIds.includes(request.arguments.pageId)) {
    return { ...request, arguments: { ...request.arguments, pageId: recovery.pageId } };
  }
  return request;
}
