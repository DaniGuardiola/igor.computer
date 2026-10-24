import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { stateDir, origin } from './config.mjs';
import { createMcpServer } from './mcp-server.mjs';

const endpoint = process.env.IGOR_COMPUTER_URL || origin;
if (!['http:', 'https:'].includes(new URL(endpoint).protocol)) throw new Error('Invalid server URL.');
if (new URL(endpoint).protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)) throw new Error('Use HTTPS for remote connections.');
const token = (await readFile(process.env.IGOR_COMPUTER_TOKEN_FILE || join(stateDir, 'token'), 'utf8')).trim();
async function call(path, args, signal) {
  const response = await fetch(endpoint + path, {
    method: args === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Igor-Workspace': process.env.IGOR_COMPUTER_WORKSPACE || 'shared', 'X-Igor-Workspace-Label': encodeURIComponent(process.env.IGOR_COMPUTER_WORKSPACE_LABEL || process.env.IGOR_COMPUTER_WORKSPACE || 'shared') },
    ...(args === undefined ? {} : { body: JSON.stringify(args) }), signal: signal || AbortSignal.timeout(180000),
  }).catch(error => { throw new Error(error.name === 'AbortError' ? 'Request cancelled.' : 'igor.computer server is unavailable. Check server status or its log.'); });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Computer service unavailable.');
  return data;
}
const server = createMcpServer(call);
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => void server.close());
