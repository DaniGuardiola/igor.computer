import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const extras = [
  { name: 'browser_status', description: 'Check computer ownership, VM lifecycle, active turns and help requests.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'browser_request_human', description: 'Ask the person for help with a login, CAPTCHA, payment, secret or decision. This only notifies them: nothing pauses, and you can keep working on other things. Returns the request; check on it with browser_wait_human. A new request from you replaces your previous open one. If you solve it another way, call browser_withdraw_human.', inputSchema: { type: 'object', properties: { message: { type: 'string', minLength: 1, maxLength: 300 }, pageId: { type: 'integer' } }, required: ['message'], additionalProperties: false } },
  { name: 'browser_wait_human', description: 'Wait up to timeoutSeconds for a help request to resolve. Outcomes: continued (the person took control and handed it back; look at the page again before going on), dismissed (the person declined; do not retry it unasked), withdrawn, replaced, expired, or waiting (still open; you may keep waiting or do other work). If no notification reached the person, give them the returned viewer URL.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, timeoutSeconds: { type: 'number', minimum: 1, maximum: 60 } }, required: ['requestId'], additionalProperties: false } },
  { name: 'browser_withdraw_human', description: 'Withdraw your open help request, for example when you found another way or the person answered in chat.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'], additionalProperties: false } },
];

export function createMcpServer(call) {
const server = new Server({ name: 'igor.computer', version: '0.2.0' }, { capabilities: { tools: {} } });
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
      let request;
      do {
        result = await call('/status', undefined, extra.signal);
        request = result.requests?.find(item => item.id === args.requestId);
        if (!request) throw new Error('Unknown or expired help request.');
        if (request.outcome) break;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(done, 500);
          function done() { extra.signal.removeEventListener('abort', abort); resolve(); }
          function abort() { clearTimeout(timer); reject(new Error('Request cancelled.')); }
          extra.signal.addEventListener('abort', abort, { once: true });
          if (extra.signal.aborted) abort();
        });
      } while (Date.now() < deadline);
      result = { request, outcome: request.outcome || 'waiting', ...(result.viewer ? { viewer: result.viewer, delivery: result.delivery } : {}) };
    } else if (req.params.name === 'browser_withdraw_human') {
      result = await call('/withdraw-request', args, extra.signal);
    } else if (req.params.name.startsWith('computer_ui_')) {
      return await call('/computer-use', req.params, extra.signal);
    } else if (req.params.name.startsWith('computer_')) {
      result = await call('/computer', req.params, extra.signal);
      if (req.params.name === 'computer_screenshot') return { content: [{ type: 'image', data: result.data, mimeType: result.mimeType }] };
    } else return await call('/call', req.params, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});

return server;
}
