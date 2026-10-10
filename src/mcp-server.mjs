import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const extras = [
  { name: 'browser_status', description: 'Check computer ownership, VM lifecycle, active turns and pending human help.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'browser_request_human', description: 'Pause browser automation and notify the user for login, CAPTCHA, or another human step. Does not focus any user window. The user chooses when to open the browser. Use browser_wait_human before continuing.', inputSchema: { type: 'object', properties: { message: { type: 'string', minLength: 1, maxLength: 300 }, pageId: { type: 'integer' } }, required: ['message'], additionalProperties: false } },
  { name: 'browser_wait_human', description: 'Wait for a specific human-help request. Returns continued, cancelled, or waiting. Open the authenticated viewer URL if no notification client is connected. Resume browser work only after continued and inspect fresh page state. Cancellation leaves automation paused.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, timeoutSeconds: { type: 'number', minimum: 1, maximum: 60 } }, required: ['requestId'], additionalProperties: false } },
];

export function createMcpServer(call) {
const server = new Server({ name: 'igor-vm', version: '0.2.0' }, { capabilities: { tools: {} } });
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
    } else if (req.params.name.startsWith('computer_')) {
      result = await call('/computer', req.params, extra.signal);
      if (req.params.name === 'computer_screenshot') return { content: [{ type: 'image', data: result.data, mimeType: result.mimeType }] };
    } else return await call('/call', req.params, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});

return server;
}
