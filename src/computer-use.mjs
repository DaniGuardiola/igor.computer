import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runtimeEnv } from './config.mjs';

// Dedicated desktop backend. Browser tools continue through DevTools MCP.
export const desktopToolNames = new Set([
  'doctor', 'list_apps', 'list_windows', 'focused_window', 'get_app_state',
  'screenshot', 'click', 'drag', 'scroll', 'press_key', 'type_text',
  'perform_action', 'set_value', 'activate_window',
]);
export function desktopTools(tools) {
  return tools.filter(tool => desktopToolNames.has(tool.name)).map(tool => ({
    ...tool, name: 'computer_ui_' + tool.name,
    description: 'Desktop accessibility/input tool in your VM workspace. Prefer browser tools for web pages. ' + tool.description,
  }));
}

// Target an app window in the calling workspace when the upstream tool supports
// window targeting. Preserve semantic snapshot indices on tools without it.
export function desktopRequest(request, schema, state, workspace) {
  const desktop = state.workspaces.find(entry => entry.name === workspace)?.desktop;
  const windows = state.windows.filter(entry => entry.desktop === desktop || entry.desktop === -1);
  const args = { ...request.arguments };
  if (schema.properties?.window_id) {
    if (args.window_id != null && !windows.some(entry => parseInt(entry.id, 16) === args.window_id)) {
      throw new Error('Target window is not in your workspace. Refresh desktop state.');
    }
    const target = windows.find(entry => entry.active) || windows[0];
    if (args.window_id == null && target) args.window_id = parseInt(target.id, 16);
    if (!target && ['computer_ui_get_app_state', 'computer_ui_activate_window'].includes(request.name)) {
      throw new Error('No open application in your workspace. Use browser tools to open a browser first.');
    }
  }
  return { ...request, arguments: args };
}

export function scopedDesktopState(value) {
  const nodes = value.accessibility_tree || [];
  const frames = nodes.filter(node => node.depth === 1 && ['frame', 'window', 'dialog'].includes(node.role));
  const title = value.window_context?.title || '';
  const matches = frames.filter(node => node.name && title.endsWith(node.name));
  const target = matches.length === 1 ? matches[0] : frames.find(node => node.states?.includes('active'));
  if (!target) return { ...value, tree_scoped: false, message: 'Could not identify the target application window. Refresh state before semantic actions.' };
  const included = new Set([target.index]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (included.has(node.parent_index) && !included.has(node.index)) {
      included.add(node.index); changed = true;
    }
  }
  return { ...value, tree_scoped: true, accessibility_tree: nodes.filter(node => node.depth === 0 || included.has(node.index)) };
}

export function scopedSemanticRequest(request, snapshot) {
  if (!['perform_action', 'set_value', 'click', 'scroll'].includes(request.name)) return request;
  const args = request.arguments;
  const semantic = args.element_index != null || args.element_identifier != null || args.name != null || args.role != null || args.states?.length || (args.text != null && request.name !== 'scroll');
  if (!semantic) return request;
  if (!snapshot?.tree_scoped) throw new Error('Inspect your application with computer_ui_get_app_state before semantic actions.');
  const matching = snapshot.accessibility_tree.filter(node => {
    if (args.element_index != null && node.index !== args.element_index) return false;
    if (args.element_identifier != null && node.object_ref !== args.element_identifier) return false;
    if (args.name != null && node.name?.toLowerCase() !== args.name.toLowerCase()) return false;
    if (args.role != null && node.role?.toLowerCase() !== args.role.toLowerCase()) return false;
    if (args.text != null && !node.text?.content?.includes(args.text)) return false;
    return !args.states?.some(state => !node.states?.includes(state));
  });
  if (matching.length !== 1) throw new Error('Control is missing or ambiguous in your window. Refresh app state and use its element index.');
  // Resolve selectors against our window-scoped tree, then use the upstream
  // snapshot index. Names such as "Back" otherwise match other Chrome windows.
  const resolved = { ...args, element_index: matching[0].index };
  for (const key of ['element_identifier', 'name', 'role', 'states', 'text']) delete resolved[key];
  return { ...request, arguments: resolved };
}

function resultData(result) {
  if (result.structuredContent) return result.structuredContent;
  try { return JSON.parse(result.content?.find(block => block.type === 'text')?.text); } catch { return null; }
}

export class ComputerUse {
  clients = new Map();
  constructor(connect = async workspace => {
    const client = new Client({ name: 'igor-computer-' + workspace, version: '0.2.0' });
    await client.connect(new StdioClientTransport({
      command: 'docker', args: ['exec', '-i', 'igor-computer', 'computer-use-linux', 'mcp'],
      env: runtimeEnv, stderr: 'inherit',
    }));
    return client;
  }) { this.connect = connect; }

  async client(workspace, generation) {
    const previous = this.clients.get(workspace);
    if (previous?.generation === generation) return previous.client;
    if (previous) { this.clients.delete(workspace); await previous.client.close(); }
    if (this.clients.size >= 32) throw new Error('Maximum 32 desktop clients.');
    const client = await this.connect(workspace);
    const entry = { client, generation };
    this.clients.set(workspace, entry);
    client.onclose = () => { if (this.clients.get(workspace) === entry) this.clients.delete(workspace); };
    return client;
  }

  async call(workspace, generation, request, signal) {
    const name = request.name.replace(/^computer_ui_/, '');
    if (!desktopToolNames.has(name)) throw new Error('Unknown desktop tool.');
    const client = await this.client(workspace, generation);
    const entry = this.clients.get(workspace);
    const targeted = scopedSemanticRequest({ name, arguments: request.arguments || {} }, entry.snapshot);
    const result = await client.callTool(targeted, undefined, { timeout: 120000, signal });
    const value = resultData(result);
    if (name === 'get_app_state' && !result.isError) {
      entry.snapshot = scopedDesktopState(value || {});
      const content = result.content.map(block => block.type === 'text' ? { ...block, text: JSON.stringify(entry.snapshot) } : block);
      return { ...result, content, ...(result.structuredContent ? { structuredContent: entry.snapshot } : {}) };
    }
    return value?.ok === false ? { ...result, isError: true } : result;
  }

  async close() {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map(entry => entry.client.close()));
  }
}
