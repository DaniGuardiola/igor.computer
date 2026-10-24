# Agent computers

Other agent computers, as described in their vendors' documentation on 2026-10-11.

| Product | Computer capabilities documented by the vendor |
| --- | --- |
| Dots | Persistent cloud computer with files, software and its own browser sessions; watch first, explicit takeover and return control; optional connected local computer. [OpenAI documentation](https://learn.chatgpt.com/docs/dots/computers-and-apps) |
| Muse | Dedicated cloud VM containing the agent and its data, browser automation, persistent credentials and a separate Sentinel that reviews outgoing actions. The announcement does not establish a general desktop app installer or Linux app launcher. [Meta announcement](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) |
| Grok Bot | One persistent computer per account shared by all Bots: browser sessions, files and command-line credentials. Each Bot gets its own screen, with live viewing and human takeover. Durable workspace files survive ordinary updates; manually installed packages are replaceable. [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps), [Computer maintenance](https://docs.x.ai/grok-bot/computers) |

## How igor.computer compares

These products and igor.computer share the same idea: an agent works best with a
persistent computer of its own, with shared logins, live viewing and human
takeover. igor.computer differs in where that computer runs and who can use it:

- It runs on your Mac or your own server, not in a vendor's cloud.
- Any MCP agent can use it, not only the vendor's agent.
- Computers are defined in an open format (`devcontainer.json` on an OCI
  image), so you can rebuild, share and modify them.
- Browser tools (Chrome DevTools) are separate from desktop tools
  (accessibility, mouse and keyboard). Shell and file tools sit alongside both.

Like Grok Bot's computers, igor.computer separates durable files from
replaceable system packages: `/workspace`, home and browser profile survive
rebuilds; packages belong in the definition.
