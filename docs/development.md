# Development

## Layout

| Path | What it is |
| --- | --- |
| `src/service.mjs` | The HTTP server: auth, routing, the list of computers. |
| `src/instance.mjs` | One computer: ownership gate, workspaces, viewer and tool routing. |
| `src/runtime.mjs`, `src/snapshot.mjs` | VM lifecycle: boot, build, sleep, wake. |
| `src/definition.mjs`, `src/image.mjs` | Reading devcontainer.json and building OS images. |
| `src/computers.mjs` | The registry of computers and their ports. |
| `src/providers.mjs` | MCP servers that run inside a computer. |
| `src/mcp.mjs`, `src/mcp-server.mjs`, `src/mcp-clients.mjs` | The stdio bridge, the MCP gateway and the internal MCP clients, on TanStack AI. |
| `src/tanstack.mjs`, `src/agent.mjs`, `src/cli.mjs` | The TanStack AI computer-use driver, the built-in agent and the `igor-computer` CLI. |
| `src/viewer.html` | The web viewer. |
| `container/` | The base OS image and its control actions (the OS contract's reference). |
| `vm/` | The Lima VM template and the resume script used after sleep. |
| `macos/` | The menu-bar app (Swift). |
| `scripts/` | Build, install and VM scripts. |

## Build

```sh
npm ci
npm run build:mac                                     # build/igor.computer.app
bash scripts/install-mac.sh --replace --enable-login  # install it and the server
```

The app bundles Node, the server and its dependencies, so the installed copy
doesn't need the checkout. To work on the server alone, run `npm start`. Give
it a separate `IGOR_COMPUTER_STATE_DIR`, `IGOR_COMPUTER_PORT` and
`IGOR_COMPUTER_LIMA_HOME` so it doesn't touch your installed computers.

Packaging, signing, Sparkle updates and the Homebrew cask are covered in
[distribution](../distribution/README.md).

## Tests

```sh
npm test          # unit tests, no VM needed
npm run test:mac  # the Mac app's settings guide
```

Live checks run against the installed server's default computer and create only
test pages and files:

```sh
bash scripts/start-fixture.sh
node tests/live.mjs              # stdio MCP, shared logins, shell, files, takeover
node tests/clients-live.mjs      # HTTP MCP with independent page selection
npm run test:vm                  # sleep and wake keep memory and form state
npm run test:desktop             # accessibility, input and screenshots
node tests/window-recovery.mjs   # reopening the last browser window
node tests/server-recovery.mjs   # server restart while in use
node tests/parallel-live.mjs WORKSPACE OTHER_WORKSPACE  # concurrent agents
```

`node scripts/catalog-computer-use.mjs [computer]` regenerates the checked-in
desktop tool schemas from the pinned computer-use-linux build.
