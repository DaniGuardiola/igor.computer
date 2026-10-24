# igor.computer

Persistent computers for your agents. One server, wherever you run it.

igor.computer is the hardware: it runs computers as native QEMU VMs managed by
Lima, sleeps them to disk with their RAM, and exposes them to agents over MCP,
with a viewer and human takeover. What runs inside is an OS image that meets a
small [OS contract](docs/computers.md#the-os-contract). The base image is stock
Debian 13 with Chromium, Xvfb and Openbox. You cook your own computers with a
standard [devcontainer.json](docs/computers.md#definitions): tools, repos, MCP
servers, services, mounts and secrets. See [docs/computers.md](docs/computers.md).

```sh
igor-computer init ~/code/acme && igor-computer create team ~/code/acme
```

Each computer has a headed desktop. Browser logins
and extensions are shared across named OS workspaces. Separate MCP workspace
connections keep their own DevTools page selection; accounts remain shared.
The macOS app and authenticated web viewer are clients of the same server.
Quitting either client does not stop the server or VM.

The Mac app's appearance setting offers System (default), Light and Dark. System
follows macOS, including automatic appearance changes. The setting updates the
client UI, a subtle gradient desktop, Openbox decorations and standard GTK/portal
settings without restarting apps. New Chromium profiles use its stock GTK theme;
users can still choose custom browser themes independently.

The agent's conversation, orchestration and task state belong outside this
computer. Igor connects through `@igor.ai/extension-computer`, with Lightpanda first,
igor.computer second, and My browser last. The server also connects to any other MCP
client; it does not depend on Igor.

## Install

macOS requires Apple Silicon, macOS 13+, Homebrew, and Xcode command-line tools
for development builds:

```sh
brew install lima qemu docker docker-buildx
npm ci
npm run build:mac
bash scripts/install-mac.sh --replace --enable-login
```

The app installs an independent LaunchAgent server in
`~/Library/Application Support/igor.computer/server`. It bundles Node and dependencies,
so neither the app nor server needs this checkout. The native app guides
notifications and its own login registration. The server starts independently
at login and stays available when the app quits. First start builds the guest
image. DMG and Homebrew distribution details are in [distribution](distribution/README.md).

A Linux host uses the same server and MCP protocol. Install Lima, native QEMU
with firmware, Docker CLI and Node 22.19+, grant the service user access to KVM,
then run:

```sh
npm ci
npm run server:install
```

The installer creates a systemd user service. For an unattended server, an
administrator must enable lingering for that service user with
`loginctl enable-linger USER`. Linux deployment is implemented but has not yet
been exercised on a real Linux/KVM host. macOS is the validated deployment.

## Connect

For local stdio MCP, configure your client with absolute installed paths:

```json
{
  "mcpServers": {
    "igor-computer": {
      "command": "/Users/NAME/Library/Application Support/igor.computer/server/bin/node",
      "args": ["/Users/NAME/Library/Application Support/igor.computer/server/src/mcp.mjs"],
      "env": {"IGOR_COMPUTER_WORKSPACE": "agent-name", "IGOR_COMPUTER": "default"}
    }
  }
}
```

`IGOR_COMPUTER` picks a named computer (default: `default`).
Remote clients can use authenticated Streamable HTTP at `https://HOST/mcp`, or
`https://HOST/computers/NAME/mcp` for a named computer,
with `Authorization: Bearer CREDENTIAL` and an optional `X-Igor-Workspace` header.
The stdio bridge also supports `IGOR_COMPUTER_URL` and `IGOR_COMPUTER_TOKEN_FILE`. Credentials
belong in private client configuration/files, never prompts or tool arguments.
The default workspace is `shared`; use a distinct workspace name per agent for
independent DevTools selection state.

The macOS menu's **server…** action accepts an HTTPS origin and credential file
for the same server on another host. The web viewer is at `/viewer`. It accepts
a credential through its connection form; it does not need a native app.

By default the server binds only `127.0.0.1:18420`. To publish it through your
own TLS reverse proxy, create `server.json` in the state directory:

```json
{"HOST":"127.0.0.1","PORT":18420,"ORIGIN":"https://computer.example.com","IDLE_SECONDS":300}
```

Preserve the public Host header and forward WebSocket upgrades. Expose only the
authenticated service port, never raw CDP/VNC or the Docker socket. A non-loopback
bind requires an HTTPS public origin; the TLS reverse proxy terminates TLS.
Environment variables `IGOR_COMPUTER_HOST`, `IGOR_COMPUTER_PORT`, `IGOR_COMPUTER_ORIGIN`,
`IGOR_COMPUTER_IDLE_SECONDS`, `IGOR_COMPUTER_LIMA_HOME` and `IGOR_COMPUTER_STATE_DIR`
override configuration. One server runs any number of computers, each in its own
VM; multi-user hosting needs separate servers.

## Computer tools

Browser automation and desktop automation are separate APIs. Chrome DevTools
MCP provides browser navigation, tabs, DOM/accessibility snapshots, page input
and JavaScript through CDP. Agents should use these directly for web tasks;
no screenshot or desktop-input step is required to navigate a page.

Desktop accessibility/input uses the pinned MIT-licensed
[computer-use-linux](https://github.com/agent-sh/computer-use-linux) v0.7.15
backend inside the guest. `computer_ui_*` tools expose application state,
AT-SPI trees, semantic selectors/actions, screenshots and physical input.
The wrapper keeps ownership checks, workspace selection, window-scoped
accessibility trees/selectors and independent client snapshot indices. Setup tools and upstream shell execution are not exposed;
`computer_exec` remains the bounded guest shell API. Supported controls depend
on what the application exports. Chromium's built-in accessibility is enabled;
there is one browser process/profile and no separate per-agent login.

Normal Chrome DevTools MCP tools remain available, alongside:

| Tool | Purpose |
| --- | --- |
| `computer_ui_get_app_state`, `computer_ui_list_apps` | Desktop accessibility trees and application discovery. |
| `computer_ui_perform_action`, `computer_ui_set_value`, `computer_ui_click` | Operate controls by accessibility identity; physical input remains available. |
| `computer_ui_screenshot`, `computer_ui_press_key`, `computer_ui_type_text`, `computer_ui_drag`, `computer_ui_scroll` | Desktop observation and input through computer-use-linux. |
| `computer_exec` | Bounded shell commands inside the guest as its unprivileged user. |
| `computer_file` | Read, write or list paths inside `/workspace`; 512 KiB per transfer. |
| `computer_workspace` | Create/select OS workspaces; open or move browser windows. |
| `computer_screenshot`, `computer_input` | Capture and interact with the calling client's workspace. |
| `computer_begin_turn`, `computer_end_turn` | Protect an entire turn from idle sleep, including gaps between tools. |
| `computer_sleep`, `computer_wake` | Save/stop and restore RAM plus disk. |
| `browser_status` | Ownership, lifecycle, active turn IDs and human help. |
| `browser_request_human`, `browser_wait_human` | Request help in the same workspace and wait for explicit takeover. |

Desktop actions serialize through one ownership gate. Pixel actions select the
calling client's workspace within that gate. Workspaces organize windows;
they do not provide separate displays, accounts or a security boundary.
Use `computer_workspace` with `open_browser` to create a window on an agent's
workspace, then inspect/select its pages through DevTools. Preserve unrelated
windows and tabs. A busy response means retry after the current action finishes.

Hold a unique turn ID from the first computer-dependent step until completion,
and release it in `finally`. Turn leases persist through server restart and
never silently expire. After an agent crash, inspect `browser_status` and
explicitly end its stale turn. Without a turn lease, idle time counts between
tool calls.

## Human control

**Your desktop** is the personal space, with no agent avatar. It opens directly
with mouse and keyboard control; use the computer freely. **Done** closes it.
Agent workspaces are created and retired automatically from Igor's agent roster.
Retiring a workspace moves its open windows to your desktop, preserving tabs and
logins. The picker has no manual workspace creation.

Selecting an agent opens a read-only live desktop of its workspace,
including Chromium's window frame, dialogs and the OS background. Watching does
not pause its agent. Desktop captures validate the selected OS workspace before
and after capture. While another workspace uses shared physical input, the view
holds its last frame; the watched desktop is restored when that command ends.

**Take control** waits for the current command, then gives mouse and keyboard to
the person. Browser, shell and file tools are blocked for that workspace only.
Other workspaces can continue browser DOM and shell/file work. Browser commands from different agents run concurrently; commands within one workspace retain a single ownership gate. Browser recovery and `new_page` create an unfocused Chromium window on the caller’s workspace, preserving shared cookies without selecting the OS desktop. Explicit `bringToFront` is suppressed for agent page selection. Explicit isolated contexts retain separate storage and are scoped by workspace. Creating their incognito window still uses the physical desktop gate because Chromium activates it despite background flags; normal shared-login pages run concurrently during human control. Shared physical
desktop input waits until takeover ends; creating or reopening a browser window
also needs that shared desktop lease. Existing browser contexts can be selected
without focus when their page identity is unambiguous.

**Done** releases takeover and returns to watching. Switching workspaces also
releases takeover and opens the next workspace read-only. Closing the native
window releases takeover and hides the viewer. The **automation** toggle is a
separate global pause, preserved when releasing or closing. The app explains a
paused close with a tip at its menu icon. Closing a web tab without **done**
retains ownership; reopen it to finish. Network disconnects never silently resume
input. Read-only previews cannot open an input-capable VNC connection.

Agent action hints show the existing workspace avatar and name, a cursor/click
hint at known target coordinates, typing indicators and recognized shortcuts.
Typed text, credentials, selectors, URLs and scripts are excluded from this
activity metadata. Hints fade after inactivity. Pins can be edited while
watching; launching, focusing, closing or restoring applications requires takeover.

An agent asks for help with a short message and optional page ID, then waits on
the returned request ID. A connected native client can notify the user. Otherwise
the response supplies a viewer URL. Only `continued` permits resumption;
`cancelled` means stop. Inspect fresh page state after takeover. No CAPTCHA
bypass, personal Chrome modification or focus theft is involved.

## Persistence and sleep

The VM's writable disk stores its container, profile, home and workspace volumes.
User-installed tools under `/home/browser`, including Python virtual environments,
survive browser/container replacement. Files belong in `/workspace`. The guest
container's root filesystem survives ordinary VM stop/sleep, but image upgrades
replace it; put custom system packages in the image recipe and rebuild it.

After five idle minutes, the server snapshots RAM and disk, then force-stops
QEMU without shutting down the saved guest. It never sleeps during an active
turn, command, pending help or human takeover. Status polling does not wake it.
The next computer tool wakes it before acting.

Restore loads the snapshot before any guest boot instructions execute. Lima's
regenerated read-only boot ISO must be remounted and its readiness markers updated;
static forwards reconnect CDP and the display. Browser forms and JavaScript survive.
DevTools reconnect changes its page IDs: call `list_pages` after wake and refresh
IDs before using them. Remote website connections can fail or sessions expire.

The snapshot records the QEMU version and refuses restoration with a changed
version. Restore the sleeping VM before upgrading QEMU. Snapshots remain local
to this machine/configuration; cross-host live migration is not promised.

On service restart, pending human ownership returns paused. Active turn leases
remain protected. On snapshot failure, the server reports the error and attempts
to keep the live VM usable instead of discarding state.

## Verification

```sh
npm test
npm run test:mac
bash scripts/start-fixture.sh
node tests/live.mjs
node tests/clients-live.mjs
npm run test:vm
node tests/window-recovery.mjs
node tests/server-recovery.mjs
```

The live checks cover real stdio and HTTP MCP, shared cookies with independent
agent page selection, shell/files, workspace windows, screenshot/input, the human
gate, RAM/form restoration, authenticated display proxy, server restart recovery
and last-window recovery. Run them while the computer
is available for verification; they create only test pages/files.

macOS snapshot save/stop and wake measured roughly 2s and 6s in these checks;
these are observations, not general performance guarantees. Linux/KVM deployment,
production TLS deployment, password-manager desktop integration, Touch ID,
passkeys and site-specific CAPTCHA behavior still require host/site validation.

The VM has no host directory mounts or SSH-agent forwarding. Chromium remains
stock and sandboxed. Raw CDP/VNC bind to host loopback and are trusted-host
implementation endpoints. The display proxy also authenticates guest-side
connections, preventing browser pages from taking over via guest localhost.
Local software running as the host user can bypass
the MCP gate. Dependencies: [Lima](https://github.com/lima-vm/lima),
[QEMU](https://www.qemu.org/), Debian Chromium, Openbox, Xvfb, noVNC/websockify,
x11vnc and [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp).

### Viewer workspaces

The native and web viewers have a workspace picker. `user` is the independent default desktop (the original `shared` workspace), with no agent owner. Igor agent workspaces display their agent names; generic MCP clients can provide `IGOR_COMPUTER_WORKSPACE_LABEL`. Create extra named workspaces from the picker. The taskbar’s browser icon opens or focuses a browser in the selected workspace. Closing every window leaves the desktop empty; browser commands lazily reopen a window in the caller’s own workspace. Desktop and shell tools do not launch a browser. The window strip shows all managed applications on the selected desktop, and restore stays on that desktop. Workspaces share one OS and Chromium profile.


To verify the installed desktop backend, finish human control and run
`npm run test:desktop`. This tests browser navigation/DOM independently, then
accessibility lookup, semantic button activation, text input and PNG capture
on a temporary task tab. Existing tabs are preserved. `scripts/catalog-computer-use.mjs`
regenerates the checked-in upstream tool schemas from the pinned built image.

### Desktop taskbar and workspace pictures

The native window and web viewer keep the taskbar below the guest display. The apps menu discovers visible graphical `.desktop` applications installed in the guest; infrastructure such as the VNC server is excluded. Chromium uses the existing persistent profile and opens or focuses its window in the selected workspace.

Pin apps from the apps menu, reorder shortcuts by dragging, or drag a shortcut away to unpin. Right-click a native shortcut for open, new Chromium window, and unpin actions. Removing a shortcut never uninstalls an app. Pins persist on the server and are shared by both viewers.

Workspace switching briefly fades through the selected workspace's picture and name, suppressing viewer input during the transition. Reduced-motion preferences disable the fade. Agent workspace IDs remain stable across renames; their pictures and names come from the roster sent to authenticated `POST /workspace-sync` as `{owner, profiles: [{id, label, avatar}]}`. `avatar` is a PNG/JPEG/WebP data URL or null. A roster sent while the computer sleeps is applied when it next wakes; syncing never wakes it.

Parallel browser acceptance check: with **your desktop** open and two existing agent workspaces, run `node tests/parallel-live.mjs <agent-workspace-id> <other-agent-workspace-id>`. It checks concurrent MCP browser actions, workspace recovery, DOM click/fill, stable personal desktop focus, and cleanup of only its own test windows.
