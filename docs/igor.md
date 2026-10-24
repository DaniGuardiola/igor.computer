# Using with Igor

igor.computer started as the computer for [Igor](https://github.com/DaniGuardiola/igor),
a personal AI assistant, and Igor remains its first user. igor.computer doesn't
depend on Igor; Igor is one MCP client among others.

Igor connects through its `@igor.ai/extension-computer` package, which:

- starts the installed server's stdio bridge for each Igor agent,
- gives every agent its own workspace, named after the agent, and
- keeps the viewer's workspace names and pictures in sync with Igor's agents
  through `POST /workspace-sync`. Retired agents' windows move to your desktop.

Set `IGOR_COMPUTER` in Igor's environment to use a named computer instead of the
default one. Igor's own docs describe its browser preference order (Lightpanda
first, igor.computer for real logins and human help, your personal browser last).
