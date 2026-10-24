import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveMCPStdio } from '@tanstack/ai-mcp/server/stdio';
import { stateDir, origin } from './config.mjs';

// The stdio bridge: MCP messages from stdin are forwarded to the server's
// HTTP MCP endpoint for the chosen computer, with this client's credentials.
const serverUrl = process.env.IGOR_COMPUTER_URL || origin;
// IGOR_COMPUTER picks a named computer on the server; the default computer otherwise.
const computer = process.env.IGOR_COMPUTER || 'default';
if (!/^[a-z][a-z0-9-]{0,19}$/.test(computer)) throw new Error('Invalid IGOR_COMPUTER name.');
const endpoint = serverUrl.replace(/\/$/, '') + (computer === 'default' ? '' : '/computers/' + computer) + '/mcp';
if (!['http:', 'https:'].includes(new URL(endpoint).protocol)) throw new Error('Invalid server URL.');
if (new URL(endpoint).protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)) throw new Error('Use HTTPS for remote connections.');
const token = (await readFile(process.env.IGOR_COMPUTER_TOKEN_FILE || join(stateDir, 'token'), 'utf8')).trim();
const workspace = process.env.IGOR_COMPUTER_WORKSPACE || 'shared';

serveMCPStdio({
  async fetch(request) {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Igor-Workspace', workspace);
    headers.set('X-Igor-Workspace-Label', encodeURIComponent(process.env.IGOR_COMPUTER_WORKSPACE_LABEL || workspace));
    headers.delete('host');
    try {
      return await fetch(endpoint, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text() });
    } catch {
      return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'igor.computer server is unavailable. Check server status or its log.' }, id: null }, { status: 502 });
    }
  },
});
