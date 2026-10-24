import { toolDefinition } from '@tanstack/ai';
import { createMCPServer } from '@tanstack/ai-mcp/server';

const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const extraTools = [
  { name: 'browser_status', annotations: { readOnlyHint: true, openWorldHint: false }, description: 'Check computer ownership, VM lifecycle, active turns and help requests.', inputSchema: object() },
  { name: 'browser_request_human', annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, description: 'Ask the person for help with a login, CAPTCHA, payment, secret or decision. This only notifies them: nothing pauses, and you can keep working on other things. Returns the request; check on it with browser_wait_human. A new request from you replaces your previous open one. If you solve it another way, call browser_withdraw_human.', inputSchema: object({ message: { type: 'string', minLength: 1, maxLength: 300 }, pageId: { type: 'integer' } }, ['message']) },
  { name: 'browser_wait_human', annotations: { readOnlyHint: true, openWorldHint: false }, description: 'Wait up to timeoutSeconds for a help request to resolve. Outcomes: continued (the person took control and handed it back; look at the page again before going on), dismissed (the person declined; do not retry it unasked), withdrawn, replaced, expired, or waiting (still open; you may keep waiting or do other work). If no notification reached the person, give them the returned viewer URL.', inputSchema: object({ requestId: { type: 'string' }, timeoutSeconds: { type: 'number', minimum: 1, maximum: 60 } }, ['requestId']) },
  { name: 'browser_withdraw_human', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: 'Withdraw your open help request, for example when you found another way or the person answered in chat.', inputSchema: object({ requestId: { type: 'string' } }, ['requestId']) },
];

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const pause = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Request cancelled.')); }, { once: true });
});

// Routes one tool call to the computer. `call(path, args, signal)` is the
// computer's dispatcher; results come back as MCP CallToolResults.
export async function callTool(call, name, args = {}, signal) {
  try {
    if (name === 'browser_status') return text(await call('/status', undefined, signal));
    if (name === 'browser_request_human') return text(await call('/request-human', args, signal));
    if (name === 'browser_withdraw_human') return text(await call('/withdraw-request', args, signal));
    if (name === 'browser_wait_human') {
      if (typeof args.requestId !== 'string' || !args.requestId) throw new Error('Provide the human-help request ID.');
      const seconds = args.timeoutSeconds ?? 55;
      if (typeof seconds !== 'number' || seconds < 1 || seconds > 60) throw new Error('Timeout must be between 1 and 60 seconds.');
      const deadline = Date.now() + seconds * 1000;
      let status, request;
      do {
        status = await call('/status', undefined, signal);
        request = status.requests?.find(item => item.id === args.requestId);
        if (!request) throw new Error('Unknown or expired help request.');
        if (request.outcome) break;
        await pause(500, signal);
      } while (Date.now() < deadline);
      return text({ request, outcome: request.outcome || 'waiting', ...(status.viewer ? { viewer: status.viewer, delivery: status.delivery } : {}) });
    }
    if (name.startsWith('computer_ui_')) return await call('/computer-use', { name, arguments: args }, signal);
    if (name.startsWith('computer_')) {
      const result = await call('/computer', { name, arguments: args }, signal);
      if (name === 'computer_screenshot') return { content: [{ type: 'image', data: result.data, mimeType: result.mimeType }] };
      return text(result);
    }
    return await call('/call', { name, arguments: args }, signal);
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
}

// The MCP endpoint agents connect to, served by TanStack AI's MCP server.
// `tools` are the computer's tool descriptors; every call goes to `call`.
export function createGateway(tools, call) {
  return createMCPServer({
    name: 'igor.computer', version: '0.2.0',
    tools: [...tools, ...extraTools].map(tool => toolDefinition({ name: tool.name, description: tool.description || '', inputSchema: tool.inputSchema || object(),
      ...(tool.title || tool.annotations ? { metadata: { ...(tool.title ? { title: tool.title } : {}), ...(tool.annotations ? { annotations: tool.annotations } : {}) } } : {}) })
      .server((args, context) => callTool(call, tool.name, args, context?.abortSignal))),
  });
}
