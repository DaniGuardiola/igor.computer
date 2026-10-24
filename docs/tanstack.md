# TanStack AI

igor.computer is built on [TanStack AI](https://tanstack.com/ai) wherever it
talks to models or to MCP:

| Part | TanStack AI package |
| --- | --- |
| The MCP endpoint agents connect to (`/mcp` and the stdio bridge) | `@tanstack/ai-mcp/server` (`createMCPServer`, `serveMCPStdio`) |
| Connections to Chrome DevTools MCP, computer-use-linux and the MCP servers inside computers | `@tanstack/ai-mcp` (`createMCPClient`) |
| The computer-use driver for your own TanStack AI apps | `@tanstack/ai-computer-use` |
| The built-in agent (`igor-computer run`) | `@tanstack/ai` (`chat`), `@tanstack/ai-anthropic`, `@tanstack/ai-openai`, `@tanstack/ai-openrouter` |

## The built-in agent

`igor-computer run` gives a task to an agent that works on a computer. It's the
quickest way to try a computer without setting up an agent client.

```sh
export ANTHROPIC_API_KEY=…            # or OPENAI_API_KEY, or OPENROUTER_API_KEY
igor-computer run "clone https://github.com/octocat/Hello-World and tell me its last commit"
igor-computer run acme "run the web app's tests and open the coverage report" --model anthropic:claude-opus-5-5
```

It uses the model's own computer-use tool for the desktop, together with the
computer's MCP tools: shell, files, Chrome DevTools, and any MCP servers from the
computer's definition. It works on its own workspace (`igor-agent`, or
`--workspace`), so you can watch it in the viewer. It holds a turn for the whole
run, so the computer doesn't sleep. When it needs you, it asks like any other
agent.

| Flag | Default |
| --- | --- |
| `--model provider:model` | The first provider with an API key: `anthropic:claude-sonnet-5-5`, `openai:gpt-6.1-sol` or `openrouter:anthropic/claude-sonnet-5-5` |
| `--workspace NAME` | `igor-agent` |
| `--steps N` | `60` model turns |

## Computer use in your own app

Any TanStack AI app can drive a computer with the model's native computer tool,
Claude's or OpenAI's:

```ts
import { chat } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'
import { createComputerUse } from '@tanstack/ai-computer-use'
import { igorComputer } from 'igor-computer/tanstack'

const computerUse = createComputerUse({
  driver: igorComputer({ computer: 'acme' }),  // url, token and workspace are optional
})

const stream = chat({
  adapter: anthropicText('claude-sonnet-5-5'),
  threadId,
  messages,
  tools: computerUse.tools,
  middleware: [computerUse.middleware],
  interrupts: [computerUse.interrupt],
})
```

`igorComputer()` is a driver factory: each chat thread gets its own workspace
(`thread-<id>`) on the computer. Pass `workspace` to pin every thread to one
workspace. The screen is 1440×1000. The driver supports zoom and cursor position,
but not `navigate`; open pages through the DevTools tools or the browser itself.
Input goes through the same ownership gate as every other agent, so it waits
while a person is in control.

To give the same app the computer's shell, files and browser tools, connect to
its MCP endpoint:

```ts
import { createMCPClient } from '@tanstack/ai-mcp'

const mcp = await createMCPClient({
  transport: { type: 'http', url: 'http://127.0.0.1:18420/computers/acme/mcp',
    headers: { Authorization: `Bearer ${token}`, 'X-Igor-Workspace': 'my-app' } },
})
const tools = [...computerUse.tools, ...await mcp.tools()]
```
