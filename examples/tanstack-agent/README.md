# An agent built with TanStack AI

[agent.mjs](agent.mjs) is a complete agent, in about 50 lines, that works on an
igor.computer computer. It uses [TanStack AI](https://tanstack.com/ai) with:

- the igor.computer **computer-use driver** (`igor-computer/tanstack`), so
  Claude uses its native computer tool on the computer's desktop, and
- the computer's **MCP tools** (shell, files, Chrome DevTools, and any MCP
  servers in its definition), through TanStack AI's MCP client.

```sh
npm install
ANTHROPIC_API_KEY=… node agent.mjs "clone https://github.com/octocat/Hello-World and tell me its last commit"
```

Watch it work by opening the computer from the menu bar and picking the
`tanstack-example` workspace. Swap `anthropicText` for another TanStack AI
adapter, such as `openaiText` from `@tanstack/ai-openai`, to use another model.
