# Connect your agent

Any MCP client can use a computer. The installed server ships a stdio bridge,
`igor-computer mcp [NAME]`. It lives at
`~/Library/Application Support/igor.computer/server/bin/igor-computer` on macOS.
Remote clients can use HTTP instead; see [Running a server](server.md#remote-access).

Give each agent its own workspace with `IGOR_COMPUTER_WORKSPACE`, so it gets its
own desktop and doesn't get in your way. Pick a named computer by passing its
name to `mcp`, or with `IGOR_COMPUTER`.

To tell the agent how to use the computer well, give it the
[agent skill](../skills/igor-computer/SKILL.md).

## Claude Code

```sh
claude mcp add --env IGOR_COMPUTER_WORKSPACE=claude-code igor-computer -- "$HOME/Library/Application Support/igor.computer/server/bin/igor-computer" mcp
```

## Codex

Add the computer to `~/.codex/config.toml`. Codex asks before calling MCP tools,
and a headless `codex exec` can't ask, so approve this server's tools up front:

```toml
[mcp_servers.igor-computer]
command = "/Users/YOU/Library/Application Support/igor.computer/server/bin/igor-computer"
args = ["mcp"]
env = { IGOR_COMPUTER_WORKSPACE = "codex" }
tool_timeout_sec = 180
default_tools_approval_mode = "approve"
```

Codex then works on the computer with your ChatGPT subscription:

```sh
codex exec "Use the igor-computer tools: open example.com in its browser and tell me the page title"
```

## Other MCP clients

```json
{
  "mcpServers": {
    "igor-computer": {
      "command": "/Users/YOU/Library/Application Support/igor.computer/server/bin/igor-computer",
      "args": ["mcp"],
      "env": { "IGOR_COMPUTER_WORKSPACE": "my-agent" }
    }
  }
}
```

## Your own agent

To build an agent, use any MCP client library against the computer's endpoint.
With [TanStack AI](tanstack.md), the model can also use its native computer-use
tool on the desktop; [examples/tanstack-agent](../examples/tanstack-agent) is a
complete example.
