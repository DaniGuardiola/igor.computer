# Computers

igor.computer is split into three layers. Each layer is a thin layer of glue
over an existing standard, and you can replace any layer as long as you keep its
contract.

| Layer | What it is | Standard underneath |
| --- | --- | --- |
| **Hardware** | The server: VMs, RAM sleep, MCP gateway, auth, viewer, human takeover, the ownership gate. | Lima, QEMU, MCP, noVNC |
| **OS** | A container image that meets the **OS contract**. The base image is the reference OS. | OCI images, Docker |
| **Definition** | How you cook your own OS: tools, repos, MCP servers, services, mounts, secrets. | devcontainer.json |

Each **computer** is one Lima VM running one container from its OS image. Computers
are fully separate: separate RAM sleep, separate browser profiles and logins,
separate `/workspace`. Within one computer, agents get **workspaces** (desktops)
that share the browser profile.

```text
host ──► igor.computer server :18420
           ├─ /…                   default computer   (VM igor-computer-default)
           ├─ /computers/team/…    team computer      (VM igor-computer-team)
           └─ /computers/<name>/…
```

## Quick start

```sh
igor-computer init ~/code/acme            # writes .igor-computer/devcontainer.json
igor-computer create team ~/code/acme     # or a git URL: igor-computer create team https://github.com/acme/eng
igor-computer wake team                   # builds and boots (first time takes a few minutes)
igor-computer ls
```

Connect an agent to it:

```json
{ "mcpServers": { "team": {
  "command": "…/igor.computer/server/bin/igor-computer", "args": ["mcp", "team"],
  "env": { "IGOR_COMPUTER_WORKSPACE": "agent-name" } } } }
```

Or over HTTP at `https://HOST/computers/team/mcp`. The viewer for a computer is
at `/computers/team/viewer`. The default computer keeps the root paths (`/mcp`,
`/viewer`). With more than one computer, the Mac app shows a **computers** menu,
and help requests from any computer raise a notification.

## Definitions

A definition is a [devcontainer.json](https://containers.dev/implementors/json_reference/).
igor.computer looks for `.igor-computer/devcontainer.json`, then `igor-computer.json`,
then `devcontainer.json` in the source folder. Comments and trailing commas are allowed.
An empty definition gives you the base computer.

Supported devcontainer properties:

| Property | Effect |
| --- | --- |
| `image` | A prebuilt image that meets the OS contract (usually published FROM the base). |
| `build.dockerfile`, `build.context`, `build.args`, `build.target` | Build your own OS layer. Start the Dockerfile with `ARG IGOR_COMPUTER_BASE` and `FROM ${IGOR_COMPUTER_BASE}`, or build any OS that meets the contract. |
| `features` | [Dev container features](https://containers.dev/features) from OCI registries, applied with the devcontainer CLI. Needs `docker-buildx`. |
| `containerEnv`, `remoteEnv` | Environment variables for everything in the computer. |
| `mounts` | Docker `--mount` entries (string or object). `bind` mounts of host folders are first shared into the VM by Lima, then bound into the container. `${localEnv:VAR}` and `${localWorkspaceFolder}` are substituted. |
| `runArgs` | Extra `docker run` arguments, passed through unchanged. |
| `postCreateCommand` | Runs once per definition revision, after repos are cloned. |
| `postStartCommand` | Runs on every cold start. |

Other devcontainer properties are ignored; `igor-computer check` lists them.

igor.computer settings live under `customizations["igor.computer"]`:

| Setting | Default | Effect |
| --- | --- | --- |
| `resources` | `{cpus: 2, memory: "3GiB", disk: "30GiB"}` | VM size. CPU and memory apply on the next cold start; disk is fixed when the VM is created. |
| `browser` | `true` | `false` removes Chromium and the DevTools tools. |
| `packages` | `[]` | Debian packages added to the image. |
| `repos` | `[]` | Git URLs (or `{url, path, ref}`) cloned into `/workspace` if missing. `GITHUB_TOKEN`/`GH_TOKEN` authenticates GitHub HTTPS clones without being stored. |
| `mcp` | `{}` | MCP servers that run inside the computer (`{command, args, env, cwd}`). Their tools appear to agents as `name__tool`, behind the same auth and ownership gate. |
| `services` | `{}` | Long-running processes (`name: command`). Restarted with backoff and logged to `/tmp/igor-computer-service-<name>.log`. |
| `secrets` | `{}` | Environment variables resolved on the host when the container starts: `env:VAR`, `file:/path`, `keychain:service` (macOS Keychain) or `op://vault/item/field` (1Password CLI). Add `?` to make one optional. Secrets never enter the image. |
| `idleSleep` | `"5m"` | Idle time before RAM sleep; `"never"` disables it. Computers with host bind mounts default to `"never"`, because QEMU cannot snapshot live host shares. |
| `lima` | `{}` | Raw [Lima](https://lima-vm.io/docs/config/) settings merged into the VM template, for example `{"mountType": "virtiofs"}`. |

See [examples/team](../examples/team/.igor-computer/devcontainer.json).

### When changes apply

A sleeping computer keeps the image it slept with. Definition changes apply on
the next cold start or on `igor-computer rebuild <name>`. A rebuild keeps
`/profile` (logins), `/home/browser` and `/workspace`, but replaces the
container, so open windows close. For git sources, `igor-computer update <name>`
pulls the latest definition.

## The OS contract

An image works with igor.computer when it has the label `ai.igor.computer.os`
holding this JSON manifest. The platform reads it, and assumes nothing else
about the OS.

```json
{
  "contract": 1,
  "control": ["python3", "/opt/igor-computer/computer.py"],
  "setup": ["python3", "/opt/igor-computer/setup.py"],
  "display": { "port": 6080, "auth": "/tmp/igor-computer-display-auth" },
  "browsers": [{ "name": "chromium", "cdpPort": 9222 }],
  "desktopTools": ["computer-use-linux", "mcp"],
  "mcp": {}
}
```

| Key | Required | The OS provides |
| --- | --- | --- |
| `control` | yes | A command called as `control <action> <json>` that prints a JSON result, or `{"error": …}` with a non-zero exit. Actions: `workspace_list`, `workspace_create`, `workspace_select`, `workspace_move`, `workspace_open_browser`, `exec`, `file`, `screenshot`, `input`, `status`, `frame`, `apps`, `apps_launch`, `roster`, `appearance`. The base image's [computer.py](../container/computer.py) is the reference. |
| `display` | yes | A noVNC/websockify endpoint on `port`, protected by HTTP Basic credentials stored as `user:password` in the file `auth`. |
| `browsers` | no | Chrome DevTools Protocol endpoints. The first one backs the DevTools tools. |
| `desktopTools` | no | A stdio MCP server exposing [computer-use-linux](https://github.com/agent-sh/computer-use-linux) tools. |
| `setup` | no | A command run after each cold start, printing `{"ok": true}`. |
| `mcp` | no | Stdio MCP servers inside the OS, exposed through the gateway. |

The container runs as an unprivileged user with all capabilities dropped. It gets
three volumes (`/profile`, `/home/browser`, `/workspace`), and the platform
publishes the display and first CDP port to the VM.

The base image (`container/`) is Debian with Xvfb, Openbox, x11vnc, noVNC,
Chromium and computer-use-linux. Definitions extend it. A completely different
OS (say Ubuntu with a different window manager) only needs to implement the
contract.

## Current limits

- Only the first CDP browser is exposed through the DevTools tools. Firefox is not supported, because chrome-devtools-mcp speaks CDP only.
- Local (`./path`) devcontainer features are not supported; publish them to a registry.
- QEMU cannot RAM-snapshot a VM with live host shares, so bind mounts and sleep don't mix.
- One person controls each computer at a time. Agents in different computers never share the mouse and keyboard; agents in the same computer do.
- Linux hosts are implemented but not yet validated on real KVM hardware.
