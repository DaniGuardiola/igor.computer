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
The setup window guides notification permission and start at login.
Settings lets you change those choices later. macOS may require approval in Login Items. Quitting the app stops its service and dedicated VM, retaining the profile.

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

The built app bundles a pinned Node 24 runtime and its service dependencies.
It runs without this checkout; public downloads still need release signing and notarization. Installing into
`~/Applications` makes launch-at-login registration possible without modifying
system Applications.

## Connect any MCP client

Run the native app first, then configure a stdio server (use your actual app install path):

```json
{
  "mcpServers": {
    "igor-browser": {
      "command": "/Applications/Igor Browser.app/Contents/Resources/runtime/bin/node",
      "args": ["/Applications/Igor Browser.app/Contents/Resources/runtime/src/mcp.mjs"]
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
stop. `setup-required` means finish setup in the macOS app; automation stays paused.
`browser_status` reports ownership, setup state, and browser/display health. The service rejects all upstream tools
while human help is pending or the user has control. One in-flight browser tool
must finish before the user can open the viewer.

## Igor extension

The extension manifest and browser skill are included for a later integration.
Keep the existing Igor browser options enabled while the standalone app is
being polished.

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

## Setup and distribution

The app checks notification permission, desktop delivery, temporary/persistent style, login registration, and browser/display health at startup and while running. Either notification style is ready; persistent is an optional recommendation for human-help requests. Incomplete setup opens once on launch; dismissing it leaves a **Finish Setup** menu item and warning icon. When everything is ready, setup closes and that menu item disappears. **Settings** remains available for deliberate changes. An AI request made while alerts are unavailable opens the setup window once for that request; automation stays paused and MCP reports `setup-required`.

Opening notifications or login approval in System Settings shows a floating guide attached to its window. It reuses extend.computer's MIT-licensed PermissionFlow window tracker without requesting Accessibility access. The notification guide follows the missing control: Allow Notifications, Desktop, then an optional Persistent recommendation. Its pointer uses existing Accessibility access when available. Otherwise, macOS 26+ default-layout notification positions are estimated from the Settings window; unfamiliar window sizes fall back to pointing at the window. Checks use public notification APIs without that permission. Runtime failures have an explicit retry and log, rather than an endless silent restart loop.

The app now bundles Node and its service dependencies; it runs independently of the source checkout. `npm run package:dmg` creates a local development disk image. Sparkle is embedded for signed app updates, but development builds have no published update feed. Homebrew cask template and release requirements are in [distribution/README.md](distribution/README.md). Public distribution, notarization, and an actual update installation remain release work.

Igor integration is deferred while this standalone app is polished. Existing Igor browser fallbacks remain in use.

The settings helper uses the same rounded material treatment as extend.computer. When existing Accessibility trust exposes the exact control, it sits beside that control and points at it; otherwise it stays attached to the Settings window. It never requests Accessibility permission for this feature. It flips sides at screen edges, leaves the toggle unobstructed, and removes the pointer when the target cannot be verified.
