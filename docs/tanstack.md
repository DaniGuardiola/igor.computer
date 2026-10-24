# TanStack AI

igor.computer uses [TanStack AI](https://tanstack.com/ai) wherever it speaks MCP,
and offers a TanStack AI driver so your own apps can use its computers.
igor.computer never runs a model itself: your agent is the brain.

| Part | TanStack AI package |
| --- | --- |
| The MCP endpoint agents connect to (`/mcp`), and the stdio bridge (`igor-computer mcp`) | `@tanstack/ai-mcp/server` (`createMCPServer`, `serveMCPStdio`) |
| Connections to Chrome DevTools MCP, computer-use-linux and the MCP servers inside computers | `@tanstack/ai-mcp` (`createMCPClient`) |
| The computer-use driver for your own TanStack AI apps | `@tanstack/ai-computer-use` |

Tool titles and annotations (read-only, destructive and so on) pass through the
gateway unchanged. MCP clients use them to decide which calls need approval.

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

[examples/tanstack-agent](../examples/tanstack-agent) puts both together into a
complete agent in about 50 lines.
