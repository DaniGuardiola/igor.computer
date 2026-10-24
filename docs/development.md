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
| `src/tanstack.mjs`, `src/cli.mjs` | The TanStack AI computer-use driver and the `igor-computer` CLI. |
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

Local builds are ad-hoc signed and don't check for updates. Releases are
covered [below](#releases); the DMG and Homebrew cask in
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

## Releases

Pushing a `vX.Y.Z` tag runs [the release workflow](../.github/workflows/release.yml)
on GitHub Actions. It tests, then builds the app, signs every Mach-O inside it
(the app, bundled Node, Sparkle) with Developer ID and the hardened runtime,
notarizes and staples the app and DMG, and publishes a GitHub release with:

- `igor.computer-X.Y.Z-arm64.dmg`, plus `igor.computer-arm64.dmg`, a copy with
  a fixed name for the permanent `releases/latest/download/` link.
- `appcast.xml`, the signed [Sparkle](https://sparkle-project.org) feed.
- `SHA256SUMS`.

The pipeline is adapted from extend.computer's and uses the same Apple
credentials.

### Cutting a release

```sh
npm version patch   # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The tag must match `package.json`. Release notes are the commit subjects since
the previous tag. A published release is never replaced: to fix one, tag a new
version. `CFBundleVersion` is the workflow's run number, which only grows; don't
recreate the workflow or installed apps stop seeing updates.

### Updates

Release builds check
`https://github.com/DaniGuardiola/igor.computer/releases/latest/download/appcast.xml`
(set the repository variable `UPDATE_FEED` before the first release to use
another HTTPS URL). Each release starts from the previous feed, adds its entry
and re-signs it, so the feed and the DMG it points at are published together.
Sparkle requires the feed and the DMG to be signed with the update key, and
"check for updates…" appears in the menu.

The server is bundled in the app, so one update covers both. Before relaunching
into an update, the app waits while any computer has a human in control, an
active turn, or is waking, saving or building. On launch, the new app reinstalls
the server if its version or build is newer. If a computer became busy anyway,
the running server is kept and the update is retried on the next launch.
Computers and their data are untouched.

While the repository is private, release downloads and the feed return 404
to the app, so updates only start working once it's public.

### One-time setup

1. Apple Developer Program membership, a **Developer ID Application**
   certificate exported with its private key as a password-protected `.p12`,
   and an App Store Connect **team** API key (`.p8`, key ID, issuer ID) for
   notarization. extend.computer's are fine to reuse.
2. A Sparkle key for igor.computer only, on a trusted Mac:

   ```sh
   bash scripts/fetch-sparkle.sh
   .deps/sparkle/bin/generate_keys --account ai.igor.computer.updates      # prints the public key
   .deps/sparkle/bin/generate_keys --account ai.igor.computer.updates -x sparkle-private-key
   ```

   The key stays in the login Keychain. Upload the exported file, back it up
   somewhere safe, then delete it. Losing the key means installed apps can't
   update.
3. A GitHub environment named `release` with these secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | The `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | Its password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)`, exactly |
| `APPLE_TEAM_ID` | The team ID |
| `APPLE_API_KEY_ID` | The API key ID |
| `APPLE_API_ISSUER` | The API key issuer ID |
| `APPLE_API_KEY` | The `.p8` file's contents |
| `SPARKLE_PRIVATE_KEY` | The exported Sparkle private key |
| `SPARKLE_PUBLIC_KEY` | The matching public key |

```sh
base64 -i certificate.p12 | gh secret set APPLE_CERTIFICATE --env release
gh secret set SPARKLE_PRIVATE_KEY --env release < sparkle-private-key
```

Never commit signing material. Keep the feed URL, Sparkle key and growing build
numbers stable once anyone has installed a release.

### Testing signing locally

With a Developer ID certificate in your Keychain, a signed build without
notarization is:

```sh
IGOR_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" npm run build:mac
```

Before the first public release, install a release DMG into `/Applications`,
publish a second release, and check that the update installs, waits while a
computer is in use, relaunches, and updates the server.
