---
name: create-computer
description: Help a person design and create their own igor.computer computer. Interview them about what the computer is for, then write its devcontainer.json definition, validate it and create it. Use when someone wants a new igor.computer computer, wants to customize one, or asks how to set up tools, repos, services, MCP servers or secrets in one.
---

# Creating an igor.computer computer

An igor.computer computer is a persistent Linux desktop in its own VM. Each one
is defined by a `devcontainer.json` (in `.igor-computer/` of a folder or git
repo) built on the igor.computer base OS: Debian with a desktop, a shell,
Python, Git and Chromium. The full reference is
[docs/computers.md](../../docs/computers.md).

Your job is to turn what the person wants into a definition. Ask, don't guess:
they know what they need the computer for, you know the format.

## 1. Interview

Ask a few questions at a time, offer sensible defaults, and skip what clearly
doesn't apply. Cover:

- **Purpose and name.** What is this computer for (a personal assistant, a
  project, a team, one agent)? Suggest a short lowercase name.
- **Where the definition lives.** A new folder, an existing project folder, or a
  git repo the team shares.
- **Tools.** Languages and CLIs (Node, Python packages, ripgrep…). Prefer Debian
  `packages`; use dev container `features` for things Debian lacks or ships too
  old; use a Dockerfile only for anything more involved.
- **Apps.** Desktop apps beyond the browser, if any. They go in `packages` too.
- **Browser.** Do agents need the browser? Leave it on unless they say no.
- **Repos.** Git repos to clone into `/workspace`, and any setup to run after
  (`postCreateCommand`, such as `npm install`).
- **Services.** Long-running processes to keep up (dev servers, watchers, bots).
- **MCP servers.** Tools that should run inside the computer for agents to use.
- **Secrets.** Tokens or keys the computer needs, and where they live on the
  host: environment variable, file, macOS Keychain or 1Password. Never put a
  secret's value in the definition.
- **Host folders.** Folders from the person's machine to mount. Mention that a
  computer with mounts doesn't sleep.
- **Size.** CPUs, memory and disk. The defaults (2 CPUs, 3 GiB, 30 GiB) suit
  light work; suggest more for builds or many services.

Summarize the answers back in a short list and confirm before writing anything.

## 2. Write the definition

Start from `igor-computer init <folder>`, which writes a commented starter, then
fill it in. Keep comments that explain non-obvious choices. A typical result:

```jsonc
{
  "name": "my-computer",
  "postCreateCommand": "cd /workspace/web && npm install",
  "customizations": {
    "igor.computer": {
      "packages": ["nodejs", "npm", "ripgrep"],
      "repos": ["https://github.com/you/web"],
      "services": { "web": "cd /workspace/web && npm run dev" },
      "mcp": { "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"] } },
      "secrets": { "GITHUB_TOKEN": "keychain:my-github" },
      "resources": { "cpus": 4, "memory": "8GiB" }
    }
  }
}
```

## 3. Check and create

```sh
igor-computer check <folder>                 # validates and lists ignored properties
igor-computer create <name> <folder-or-git-url>
igor-computer status <name>                  # first start builds the image
```

Fix anything `check` reports before creating. The first start takes a few
minutes. Then show the person how to connect an agent (`igor-computer mcp
<name>`, see [docs/agents.md](../../docs/agents.md)) and how to watch it
(`igor-computer viewer <name>`).

## Changing it later

Edit the definition, then `igor-computer rebuild <name>`. A rebuild keeps logins,
home and `/workspace`, but closes open windows, so say so first. For a
git-sourced computer, push the change and run `igor-computer update <name>`.
