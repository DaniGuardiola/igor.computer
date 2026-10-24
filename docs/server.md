# Running a server

The Mac app installs and runs the server for you. This page is for running it
somewhere else (a Linux box, a home server) or reaching it from other machines.

## Linux

Install Lima, native QEMU with firmware, the Docker CLI and Node 22.19+. Give
the service user access to `/dev/kvm`. Then, from a checkout:

```sh
npm ci
npm run server:install
```

This installs the server into `~/.local/share/igor-computer/server` and creates
a systemd user service. To keep it running without a login session, an
administrator runs `loginctl enable-linger USER`. Linux support is implemented
but hasn't been tested on real KVM hardware yet.

## Configuration

Settings come from `server.json` in the state folder
(`~/Library/Application Support/igor.computer` on macOS,
`~/.local/state/igor-computer` on Linux), or from environment variables:

| `server.json` | Environment variable | Default |
| --- | --- | --- |
| `HOST` | `IGOR_COMPUTER_HOST` | `127.0.0.1` |
| `PORT` | `IGOR_COMPUTER_PORT` | `18420` |
| `ORIGIN` | `IGOR_COMPUTER_ORIGIN` | `http://HOST:PORT` |
| `IDLE_SECONDS` | `IGOR_COMPUTER_IDLE_SECONDS` | `300` (a computer's `idleSleep` overrides it) |
| `LIMA_HOME` | `IGOR_COMPUTER_LIMA_HOME` | `~/.lima` |
| | `IGOR_COMPUTER_STATE_DIR` | the state folder above |

The state folder holds the access token (`token`), the list of computers
(`computers.json`) and each computer's state under `computers/NAME/`.

## Remote access

To reach the server from other machines, put it behind your own TLS reverse
proxy and set its public origin:

```json
{"HOST":"127.0.0.1","PORT":18420,"ORIGIN":"https://computer.example.com"}
```

The proxy must keep the public `Host` header and forward WebSocket upgrades.
Publish only the server port. Never publish the raw DevTools or display ports,
or the Docker socket. Binding to anything other than localhost requires an
HTTPS origin.

Clients then connect with the token from the state folder:

- **MCP over HTTP:** `https://computer.example.com/mcp` (or `/computers/NAME/mcp`)
  with `Authorization: Bearer TOKEN`, plus an optional `X-Igor-Workspace` header
  naming the agent's workspace and `X-Igor-Workspace-Label` for its display name.
- **stdio bridge:** `igor-computer mcp [NAME]` with `IGOR_COMPUTER_URL` and
  `IGOR_COMPUTER_TOKEN_FILE`.
- **Mac app:** its **server…** menu item takes an HTTPS origin and a token file.
- **Web viewer:** `https://computer.example.com/viewer` (or
  `/computers/NAME/viewer`). It asks for the token.
- **CLI:** `IGOR_COMPUTER_URL=https://computer.example.com igor-computer ls`.

The bridge refuses plain HTTP to anything other than localhost.

One server runs any number of computers, but for one person: everyone with the
token controls every computer. For several people, run a server each.
