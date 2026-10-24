// A small agent that works on an igor.computer computer, built with TanStack AI.
// It uses Claude's native computer-use tool for the desktop, plus the
// computer's own MCP tools: shell, files, the browser and definition servers.
//
//   ANTHROPIC_API_KEY=… node agent.mjs "open example.com and tell me its title"
//
// IGOR_COMPUTER picks a named computer; IGOR_COMPUTER_URL and
// IGOR_COMPUTER_TOKEN_FILE reach a remote server.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chat, maxIterations } from '@tanstack/ai';
import { anthropicText } from '@tanstack/ai-anthropic';
import { createComputerUse } from '@tanstack/ai-computer-use';
import { createMCPClient } from '@tanstack/ai-mcp';
import { igorComputer } from 'igor-computer/tanstack';
import { stateDir, origin } from 'igor-computer/config';

const task = process.argv.slice(2).join(' ');
if (!task) throw new Error('Give the agent a task.');
const computer = process.env.IGOR_COMPUTER || 'default';
const workspace = 'tanstack-example';
const url = (process.env.IGOR_COMPUTER_URL || origin).replace(/\/$/, '') + (computer === 'default' ? '' : '/computers/' + computer);
const token = (await readFile(process.env.IGOR_COMPUTER_TOKEN_FILE || join(stateDir, 'token'), 'utf8')).trim();

// The computer's tools, minus the raw screenshot and input that the computer tool covers.
const mcp = await createMCPClient({ transport: { type: 'http', url: url + '/mcp',
  headers: { Authorization: `Bearer ${token}`, 'X-Igor-Workspace': workspace } } });
const tools = (await mcp.tools()).filter(tool => !['computer_screenshot', 'computer_input'].includes(tool.name));
const computerUse = createComputerUse({ driver: igorComputer({ computer, token, workspace }) });

try {
  const stream = chat({
    adapter: anthropicText('claude-sonnet-5-5'),
    threadId: 'example',
    systemPrompts: ['You work on a persistent Linux computer that a person can watch. Use the shell and files for commands, the browser tools for web pages, and the computer tool for anything visual. Ask the person for help with logins and secrets.'],
    messages: [{ role: 'user', content: task }],
    tools: [...computerUse.tools, ...tools],
    middleware: [computerUse.middleware],
    interrupts: [computerUse.interrupt],
    agentLoopStrategy: maxIterations(40),
  });
  for await (const event of stream) {
    if (event.type === 'TEXT_MESSAGE_CONTENT') process.stdout.write(event.delta);
    if (event.type === 'TOOL_CALL_START') process.stderr.write(`\n· ${event.toolCallName}\n`);
  }
  process.stdout.write('\n');
} finally {
  await computerUse.close();
  await mcp.close();
}
