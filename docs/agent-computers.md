# Agent computers

Checked against official product documentation on 2026-10-11.

| Product | Computer capabilities documented by the vendor |
| --- | --- |
| Dots | Persistent cloud computer with files, software and its own browser sessions; watch first, explicit takeover and return control; optional connected local computer. [OpenAI documentation](https://learn.chatgpt.com/docs/dots/computers-and-apps) |
| Muse | Dedicated cloud VM containing the agent and its data, browser automation, persistent credentials and a separate Sentinel that reviews outgoing actions. The announcement does not establish a general desktop app installer or Linux app launcher. [Meta announcement](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) |
| Grok Bot | One persistent computer per account shared by all Bots: browser sessions, files and command-line credentials. Each Bot gets its own screen, with live viewing and human takeover. Durable workspace files survive ordinary updates; manually installed packages are replaceable. [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps), [Computer maintenance](https://docs.x.ai/grok-bot/computers) |

## Implications for igor.computer

Our shared logins, agent workspaces, live viewing, takeover and persistent home,
profile and workspace volumes already fit the shared-computer model. We expose
browser tools independently of desktop tools, plus shell/files and accessibility
through computer-use-linux. Chromium is currently the only installed GUI app.

Use a compact icon grid for the launcher. Keep pinning on drag and the context
menu. Categories make sense when there are enough installed apps to need them.
A future app installer should record a reproducible package manifest: persistent
files and an installed OS package are different things, especially when replacing
the guest container. This change does not add an installer or new guest apps.
