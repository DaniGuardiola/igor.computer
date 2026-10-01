# Igor Browser

A headed Chromium that stays off your Mac desktop until you want it.

Igor Browser runs an unmodified distribution Chromium in a dedicated ARM64
Colima VM. Xvfb owns its display; noVNC streams the whole browser into a native
macOS window. The menu-bar app starts the local service. MCP clients use normal
Chrome DevTools tools plus a small human-handoff layer.

## Use it

Choose **Show Browser** in the globe menu to configure extensions, sign in, or
inspect the browser. Automation pauses before you get control. **Done — Return
to Agent** hides the window and resumes automation. **Hide — Keep Paused** or
closing the window leaves automation paused.

When an agent needs help, it supplies a short instruction and pauses. The globe
changes to a help indicator. With notifications enabled, clicking the notification
opens the same browser. No browser relaunch, profile transfer, or page reload.
Choose **Enable Help Notifications…** once to grant macOS notification permission.
The installer registers start at login; the menu lets you disable or re-enable it. macOS may require approval in Login Items. Quitting the app stops its service and dedicated VM, retaining the profile.

## Development setup

Requires Apple Silicon, macOS 13+, Xcode command-line tools, Node.js 22.19+
(or a newer supported Node.js release), and Homebrew.

```sh
brew install colima docker
npm ci
colima start igor-browser --arch aarch64 --vm-type vz --cpu 2 --memory 3 \
  --disk 20 --runtime docker --mount none --activate=false
npm run vm:build
npm run vm:start
npm run build:mac
bash scripts/install-mac.sh
```

The prototype app expects this checkout and its installed Node.js binary to stay
in place. It is not yet a self-contained, notarized download. Installing into
`~/Applications` makes launch-at-login registration possible without modifying
system Applications.

## Connect any MCP client

Run the native app first, then configure a stdio server:

```json
{
  "mcpServers": {
    "igor-browser": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/igor-browser/src/mcp.mjs"]
    }
  }
}
```

The MCP bridge reads its local credential directly from Application Support.
Do not put that credential in prompts or tool arguments. Closing an MCP client
leaves the service and browser running.

Human handoff uses `browser_request_human({message, pageId})`, then
`browser_wait_human({requestId, timeoutSeconds})`. A `continued` result permits
resuming after a fresh snapshot. `waiting` means wait again; `cancelled` means
stop. `browser_status` reports ownership. The service rejects all upstream tools
while human help is pending or the user has control. One in-flight browser tool
must finish before the user can open the viewer.

## Igor extension

This package includes `igor.extension.json` and a browser skill. Install this
checkout as a direct dependency of the Igor workspace and enable **Igor Browser**.
Use Lightpanda first and Igor Browser for incompatible sites. Disable Dedicated
Chrome and My browser after testing the replacement on your real tasks.

This first version has one shared profile and one ownership gate for all clients.
It does not isolate accounts between Igor agents. Tabs and profile data belong
to the service, not to an MCP client's lifetime.

## What persists

The named Docker volume `igor-browser-profile` stores Chromium's complete profile.
Clean shutdown flushes it before stopping the virtual display. Human takeover
preserves live page state; restarting the browser preserves saved cookies and
storage but not unsaved forms or JavaScript state. Sites may expire sessions.
The service restores interrupted human takeover as paused, never as automatic
permission to continue a cancelled task.

## Local boundaries

The dedicated VM has no macOS directory mounts or SSH-agent forwarding. The
container runs as an unprivileged user, drops host capabilities, and uses
Chromium's namespace and seccomp renderer sandbox. Its Docker seccomp profile
extends Moby's default only for namespace creation and sandbox chroot.

Service, display, and CDP ports bind to macOS loopback. The service checks a
private credential and Origin/Host headers. The viewer WebSocket requires human
control and disconnects on return/cancel. Raw local CDP and display ports are
trusted-machine implementation endpoints; local processes could bypass the MCP
ownership gate. They are not an isolation boundary against untrusted software
running as the Mac user. Do not publish them to a LAN or the internet.

Password-manager desktop integration, Touch ID, passkeys, and real CAPTCHA/site
compatibility need hands-on validation. A headed browser does not guarantee a
website accepts automation. There is no CAPTCHA bypass or fingerprint spoofing.

## Check and stop

```sh
npm test
node tests/live.mjs
```

`tests/live.mjs` uses the harmless fixture at guest `http://127.0.0.1:8080`.
Run `bash scripts/start-fixture.sh` first. It tests MCP discovery, page state,
pause/resume, authorization, and cancellation. It writes only test cookies/storage.

```sh
docker --context colima-igor-browser stop igor-browser
colima stop igor-browser
```

Stopping preserves the profile. Do not delete the named volume unless you intend
to remove saved browser sessions. VM memory allocation is a ceiling; measure
container, VM, and macOS service separately rather than calling it total RAM use.

## Building blocks

- [Colima](https://github.com/abiosoft/colima), backed by [Lima](https://github.com/lima-vm/lima)
- Stock [Debian Chromium](https://packages.debian.org/bookworm/chromium)
- [noVNC](https://github.com/novnc/noVNC), websockify, Xvfb, Openbox, x11vnc
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)

DevTools MCP usage telemetry and CrUX requests are disabled. No custom Chromium
fork, modified app bundle, private macOS display API, or personal Chrome profile.
