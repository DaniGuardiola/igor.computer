import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connectStdio } from './mcp-clients.mjs';
import { container } from './guest.mjs';

export const separator = '__';

// MCP servers that the computer's OS declares (manifest.mcp), started inside
// the guest on first use and exposed through the gateway as server__tool.
export class Providers {
  clients = new Map();
  constructor(context, connect) {
    this.context = context;
    this.file = join(context.dir, 'providers.json');
    this.connect = connect || ((name, server, onClose) => connectStdio({
      command: 'docker',
      args: ['exec', '-i', ...Object.entries(server.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        ...(server.cwd ? ['-w', server.cwd] : []), container, server.command, ...server.args],
      env: context.env, onClose,
    }));
  }
  // Tool lists are cached per manifest, so listing tools never wakes a computer.
  async cached() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return {}; }
  }
  async tools(manifest, { refresh = false } = {}) {
    const servers = manifest?.mcp || {};
    const cache = await this.cached();
    const key = JSON.stringify(servers);
    if (!refresh && cache.key === key) return cache.tools;
    if (!refresh) return Object.keys(servers).length ? null : [];
    const tools = [];
    for (const name of Object.keys(servers)) {
      try {
        const listed = (await (await this.client(name, servers[name])).listTools()).tools;
        tools.push(...listed.map(tool => ({ ...tool, name: name + separator + tool.name, description: `[${name}] ${tool.description || ''}`.trim() })));
      } catch (error) { console.error(`[${this.context.name}] MCP server ${name}:`, error.message); }
    }
    await mkdir(this.context.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.file + '.tmp', JSON.stringify({ key, tools }), { mode: 0o600 });
    await rename(this.file + '.tmp', this.file);
    return tools;
  }
  async client(name, server) {
    const previous = this.clients.get(name);
    if (previous && previous.key === JSON.stringify(server)) return previous.client;
    if (previous) { this.clients.delete(name); await previous.client.close().catch(() => {}); }
    const entry = { key: JSON.stringify(server) };
    entry.client = await this.connect(name, server, () => { if (this.clients.get(name) === entry) this.clients.delete(name); });
    this.clients.set(name, entry);
    return entry.client;
  }
  owns(manifest, tool) {
    const index = tool.indexOf(separator);
    return index > 0 && Object.hasOwn(manifest?.mcp || {}, tool.slice(0, index));
  }
  async call(manifest, request, signal) {
    const index = request.name.indexOf(separator);
    const name = request.name.slice(0, index);
    const client = await this.client(name, manifest.mcp[name]);
    return client.callTool({ name: request.name.slice(index + separator.length), arguments: request.arguments || {} }, { timeout: 120000, signal });
  }
  // Container replacement ends every guest process; reconnect on next use.
  async close() {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map(entry => entry.client.close()));
  }
}
