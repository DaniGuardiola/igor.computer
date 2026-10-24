// A built-in agent for one computer, on TanStack AI: the model's native
// computer-use tool drives the desktop, and the computer's own MCP tools
// (shell, files, browser, definition servers) come through its gateway.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chat, maxIterations } from '@tanstack/ai';
import { createMCPClient } from '@tanstack/ai-mcp';
import { createComputerUse } from '@tanstack/ai-computer-use';
import { stateDir, origin } from './config.mjs';
import { igorComputer } from './tanstack.mjs';

// The computer tool covers screenshots and raw input, so these duplicates stay out.
const replaced = new Set(['computer_screenshot', 'computer_input', 'computer_ui_screenshot', 'computer_ui_click', 'computer_ui_drag', 'computer_ui_scroll', 'computer_ui_press_key', 'computer_ui_type_text']);

const providers = {
  anthropic: { key: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5-5', adapter: async model => (await import('@tanstack/ai-anthropic')).anthropicText(model) },
  openai: { key: 'OPENAI_API_KEY', model: 'gpt-6.1-sol', adapter: async model => (await import('@tanstack/ai-openai')).openaiText(model) },
  openrouter: { key: 'OPENROUTER_API_KEY', model: 'anthropic/claude-sonnet-5-5', adapter: async model => (await import('@tanstack/ai-openrouter')).openRouterResponsesText(model) },
};

// "anthropic:claude-opus-5-5", "openai", or nothing: the first provider with an API key.
export function chooseModel(spec, environment = process.env) {
  const [name, ...rest] = spec ? spec.split(':') : [Object.keys(providers).find(key => environment[providers[key].key])];
  const provider = providers[name];
  if (!provider) throw new Error(spec ? `Unknown provider in "${spec}". Use anthropic, openai or openrouter.` : 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY, or pass --model provider:model.');
  if (!environment[provider.key]) throw new Error(`Set ${provider.key} to use ${name}.`);
  return { provider: name, model: rest.join(':') || provider.model, adapter: () => provider.adapter(rest.join(':') || provider.model) };
}

export const systemPrompt = `You are working on a persistent Linux computer (Debian, 1440x1000 desktop) that a person can watch and take over.
Use the shell (computer_exec) and files (computer_file, /workspace) for commands and files, the Chrome DevTools tools for web pages, and the computer tool for desktop apps and anything visual.
Your desktop is your own workspace; leave other windows and tabs alone. Logins are shared with the person.
When you need the person (a login, CAPTCHA, payment, secret or decision), call browser_request_human, keep working on other parts if you can, and check back with browser_wait_human. Never type secrets or solve CAPTCHAs yourself.`;

export async function runAgent({ task, computer = 'default', model, workspace = 'igor-agent', url = process.env.IGOR_COMPUTER_URL || origin, tokenFile = process.env.IGOR_COMPUTER_TOKEN_FILE || join(stateDir, 'token'), steps = 60, onEvent = () => {}, signal } = {}) {
  const chosen = chooseModel(model);
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const base = url.replace(/\/$/, '') + (computer === 'default' ? '' : '/computers/' + computer);
  const headers = { Authorization: `Bearer ${token}`, 'X-Igor-Workspace': workspace, 'X-Igor-Workspace-Label': encodeURIComponent(workspace) };
  const mcp = await createMCPClient({ transport: { type: 'http', url: base + '/mcp', headers }, requestOptions: { timeout: 180000 } });
  const computerUse = createComputerUse({ driver: igorComputer({ url, token, computer, workspace }) });
  const threadId = 'run-' + randomUUID();
  const turnId = threadId;
  const rest = (name, args) => fetch(base + '/computer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
  try {
    const tools = (await mcp.tools()).filter(tool => !replaced.has(tool.name));
    // Hold the computer awake for the whole run.
    await rest('computer_begin_turn', { turnId });
    const abortController = new AbortController();
    signal?.addEventListener('abort', () => abortController.abort(), { once: true });
    const stream = chat({
      adapter: await chosen.adapter(), threadId, abortController,
      systemPrompts: [systemPrompt],
      messages: [{ role: 'user', content: task }],
      tools: [...computerUse.tools, ...tools],
      middleware: [computerUse.middleware],
      interrupts: [computerUse.interrupt],
      agentLoopStrategy: maxIterations(steps),
    });
    let text = '';
    for await (const event of stream) {
      if (event.type === 'TEXT_MESSAGE_CONTENT') text += event.delta;
      onEvent(event);
    }
    return { model: `${chosen.provider}:${chosen.model}`, text };
  } finally {
    await rest('computer_end_turn', { turnId }).catch(() => {});
    await computerUse.close().catch(() => {});
    await mcp.close().catch(() => {});
  }
}
