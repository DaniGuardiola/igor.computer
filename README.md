# Igor VM

A persistent computer for your agents. One server, wherever you run it.

The server owns a native-architecture QEMU Linux VM managed by Lima. Inside it,
stock Debian 13 Chromium, Xvfb and Openbox provide a headed desktop. Browser logins
and extensions are shared across named OS workspaces. Separate MCP workspace
connections keep their own DevTools page selection; accounts remain shared.
The macOS app and authenticated web viewer are clients of the same server.
Quitting either client does not stop the server or VM.

The agent's conversation, orchestration and task state belong outside this
computer. Igor connects through `@igor.ai/extension-vm`, with Lightpanda first,
Igor VM second, and My browser last. The server also connects to any other MCP
client; it does not depend on Igor.

## Install

macOS requires Apple Silicon, macOS 13+, Homebrew, and Xcode command-line tools
for development builds:

```sh
brew install lima qemu docker
npm ci
npm run build:mac
bash scripts/install-mac.sh --replace --enable-login
```

The app installs an independent LaunchAgent server in
`~/Library/Application Support/Igor VM/server`. It bundles Node and dependencies,
so neither the app nor server needs this checkout. The bundle identifier and credential directory remain stable across the rename,
so existing notification permissions and credentials are retained. The native app guides
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
    "igor-vm": {
      "command": "/Users/NAME/Library/Application Support/Igor VM/server/bin/node",
      "args": ["/Users/NAME/Library/Application Support/Igor VM/server/src/mcp.mjs"],
      "env": {"IGOR_VM_WORKSPACE": "agent-name"}
    }
  }
}
```

Remote clients can use authenticated Streamable HTTP at `https://HOST/mcp`,
with `Authorization: Bearer CREDENTIAL` and an optional `X-Igor-Workspace` header.
The stdio bridge also supports `IGOR_VM_URL` and `IGOR_VM_TOKEN_FILE`. Credentials
belong in private client configuration/files, never prompts or tool arguments.
The default workspace is `shared`; use a distinct workspace name per agent for
independent DevTools selection state.

The macOS menu's **server…** action accepts an HTTPS origin and credential file
for the same server on another host. The web viewer is at `/viewer`. It accepts
a credential through its connection form; it does not need a native app.

By default the server binds only `127.0.0.1:18420`. To publish it through your
own TLS reverse proxy, create `server.json` in the state directory:

```json
{"HOST":"127.0.0.1","PORT":18420,"ORIGIN":"https://vm.example.com","IDLE_SECONDS":300}
```

Preserve the public Host header and forward WebSocket upgrades. Expose only the
authenticated service port, never raw CDP/VNC or the Docker socket. A non-loopback
bind requires an HTTPS public origin; the TLS reverse proxy terminates TLS.
Environment variables `IGOR_VM_HOST`, `IGOR_VM_PORT`, `IGOR_VM_ORIGIN`,
`IGOR_VM_IDLE_SECONDS`, `IGOR_VM_NAME`, `IGOR_VM_LIMA_HOME` and
`IGOR_VM_STATE_DIR` override configuration. This version runs one persistent
computer per host; multi-user hosting needs separate hosts or isolated VM services.

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

**Open computer** opens a read-only live desktop of the selected workspace,
including Chromium's window frame, dialogs and the OS background. Watching does
not pause its agent. Desktop captures validate the selected OS workspace before
and after capture. While another workspace uses shared physical input, the view
holds its last frame; the watched desktop is restored when that command ends.

**Take control** waits for the current command, then gives mouse and keyboard to
the person. Browser, shell and file tools are blocked for that workspace only.
Other workspaces can continue browser DOM and shell/file work. Shared physical
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

## Migration and rollback

`scripts/migrate-browser.sh` copies the former Colima profile after clean shutdown.
It refuses to overwrite an existing target profile and saves a private tar backup.
The previous VM and volume remain intact. The macOS installer archives the
former app in the same private backup directory and refreshes its login path. VZ-to-QEMU migration restarts Chromium
once; saved sessions transfer, unsaved RAM cannot transfer between drivers.

The initial migration has a Git checkpoint tag,
`checkpoint/browser-before-vm-20261010`, and a profile backup under
`~/Library/Application Support/Igor VM/backups`. To roll back, stop the new server
LaunchAgent, stop `igor-vm`, restore the checkpoint app/code and start the old
Colima profile. Keep the newer VM/data until you decide whether to migrate any
changes back. Git rollback alone does not roll back browser data.

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

The native and web viewers have a workspace picker. `user` is the independent default desktop (the original `shared` workspace), with no agent owner. Igor agent workspaces display their agent names; generic MCP clients can provide `IGOR_VM_WORKSPACE_LABEL`. Create extra named workspaces from the picker. The taskbar’s browser icon opens or focuses a browser in the selected workspace. Closing every window leaves the desktop empty; browser commands lazily reopen a window in the caller’s own workspace. Desktop and shell tools do not launch a browser. The window strip shows all managed applications on the selected desktop, and restore stays on that desktop. Workspaces share one OS and Chromium profile.


To verify the installed desktop backend, finish human control and run
`npm run test:desktop`. This tests browser navigation/DOM independently, then
accessibility lookup, semantic button activation, text input and PNG capture
on a temporary task tab. Existing tabs are preserved. `scripts/catalog-computer-use.mjs`
regenerates the checked-in upstream tool schemas from the pinned built image.

### Desktop taskbar and workspace pictures

The native window and web viewer keep the taskbar below the guest display. The apps menu discovers visible graphical `.desktop` applications installed in the guest; infrastructure such as the VNC server is excluded. Chromium uses the existing persistent profile and opens or focuses its window in the selected workspace.

Pin apps from the apps menu, reorder shortcuts by dragging, or drag a shortcut away to unpin. Right-click a native shortcut for open, new Chromium window, and unpin actions. Removing a shortcut never uninstalls an app. Pins persist on the server and are shared by both viewers.

Workspace switching briefly fades through the selected workspace's picture and name, suppressing viewer input during the transition. Reduced-motion preferences disable the fade. Agent workspace IDs remain stable across renames; their pictures and names can be updated through authenticated `POST /workspace-profile` using the workspace header and `{label, avatar}`. `avatar` is a PNG/JPEG/WebP data URL or null; metadata updates do not wake the VM or acquire desktop control.
