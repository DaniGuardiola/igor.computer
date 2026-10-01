import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const stateDir = process.env.IGOR_BROWSER_STATE_DIR || join(homedir(), 'Library/Application Support/Igor Browser');
const token = (await readFile(join(stateDir, 'token'), 'utf8')).trim();
async function call(path, args, signal) {
  const response = await fetch('http://127.0.0.1:18420' + path, {
    method: args === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(args === undefined ? {} : { body: JSON.stringify(args) }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Browser service unavailable.');
  return data;
}
const extras = [
  { name: 'browser_status', description: 'Check browser ownership and pending human help.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'browser_request_human', description: 'Pause browser automation and notify the user for login, CAPTCHA, or another human step. Does not focus any Mac window. The user chooses when to open the browser. Use browser_wait_human before continuing.', inputSchema: { type: 'object', properties: { message: { type: 'string', minLength: 1, maxLength: 300 }, pageId: { type: 'integer' } }, required: ['message'], additionalProperties: false } },
  { name: 'browser_wait_human', description: 'Wait for a specific human-help request. Returns continued, cancelled, or waiting. Resume browser work only after continued and inspect fresh page state. Cancellation leaves automation paused.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, timeoutSeconds: { type: 'number', minimum: 1, maximum: 60 } }, required: ['requestId'], additionalProperties: false } },
];
const server = new Server({ name: 'igor-browser', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...(await call('/tools')).tools, ...extras] }));
server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const args = req.params.arguments || {};
  try {
    let result;
    if (req.params.name === 'browser_status') result = await call('/status', undefined, extra.signal);
    else if (req.params.name === 'browser_request_human') result = await call('/request-human', args, extra.signal);
    else if (req.params.name === 'browser_wait_human') {
      if (typeof args.requestId !== 'string' || !args.requestId) throw new Error('Provide the human-help request ID.');
      const seconds = args.timeoutSeconds ?? 55;
      if (typeof seconds !== 'number' || seconds < 1 || seconds > 60) throw new Error('Timeout must be between 1 and 60 seconds.');
      const deadline = Date.now() + seconds * 1000;
      do {
        result = await call('/status', undefined, extra.signal);
        if (result.request?.id !== args.requestId) throw new Error('Human-help request is no longer current.');
        if (result.request.outcome) break;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(done, 500);
          function done() { extra.signal.removeEventListener('abort', abort); resolve(); }
          function abort() { clearTimeout(timer); reject(new Error('Request cancelled.')); }
          extra.signal.addEventListener('abort', abort, { once: true });
          if (extra.signal.aborted) abort();
        });
      } while (Date.now() < deadline);
      result = { ...result, outcome: result.request?.outcome || 'waiting' };
    } else return await call('/call', req.params, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => void server.close());
