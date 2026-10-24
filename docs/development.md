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

## Build and run from source

You need an Apple Silicon Mac with macOS 13 or later, [Homebrew](https://brew.sh)
and Xcode command-line tools.

```sh
brew install lima qemu docker docker-buildx
git clone https://github.com/DaniGuardiola/igor.computer && cd igor.computer
npm ci
npm run build:mac                                     # build/igor.computer.app
bash scripts/install-mac.sh --replace --enable-login  # install it and the server
```

This installs the **igor.computer** menu-bar app and a background server. The
first start builds the computer, which takes a few minutes.

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

Releases go through [Changesets](https://github.com/changesets/changesets) and
GitHub Actions, the same flow as extend.computer's:

1. With a user-visible change, run `npm run changeset`, pick a bump and describe
   it. Commit the generated file with the change. Docs and test-only changes can
   skip it.
2. On main, [the version workflow](../.github/workflows/version.yml) turns
   pending changesets into a release PR that bumps `package.json` and writes
   `CHANGELOG.md`.
3. Merging that PR runs [the release workflow](../.github/workflows/release.yml).
   It tests, then builds the app, signs every Mach-O inside it (the app, bundled
   Node, Sparkle) with Developer ID and the hardened runtime, notarizes and
   staples the app and DMG, and publishes release `vX.Y.Z` with the DMG,
   `SHA256SUMS` and the changelog section as notes. Stable releases also get
   `igor.computer-arm64.dmg`, a fixed-name copy for the permanent
   `releases/latest/download/` link. Then it publishes the signed
   [Sparkle](https://sparkle-project.org) feed.

Don't edit the version by hand. A published release is never replaced: to fix
one, release a new version. If only the feed step failed, re-run the workflow;
it reuses the published DMG. `CFBundleVersion` is the workflow's run number,
which only grows; don't recreate the workflow or installed apps stop seeing
updates.

### Channels

Stable, beta, alpha and canary. The channel comes from the version: `0.3.0` is
stable, `0.3.0-beta.0` is beta. For a preview, enter prerelease mode first and
release as usual; exit it to graduate:

```sh
npm run changeset -- pre enter beta   # or alpha, canary; commit .changeset/pre.json
npm run changeset -- pre exit         # back to stable
```

Previews are GitHub prereleases and never become latest.

### Updates

There's one signed feed for every channel, on the `updates` branch served by
GitHub Pages at
`https://daniguardiola.github.io/igor.computer/updates/macos/appcast.xml` (set
the repository variable `UPDATE_FEED` before the first release to use another
HTTPS URL). Preview entries carry a Sparkle channel. In the app,
"update channel" in the menu picks one; it starts as the channel the build was
released on. Each channel also gets everything more stable than it (beta gets
stable releases too), and Sparkle never offers a lower build, so going back to
stable waits for a newer stable release. Earlier entries stay in the feed for
older systems.

The server is bundled in the app, so one update covers both. Before relaunching
into an update, the app waits while any computer has a human in control, an
active turn, or is waking, saving or building. On launch, the new app reinstalls
the server if its version or build is newer. If a computer became busy anyway,
the running server is kept and the update is retried on the next launch.
Computers and their data are untouched.

While the repository is private, release downloads return 404 to the app, so
updates only start working once it's public.

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
3. In the repository settings, allow GitHub Actions to create pull requests,
   and after the first release, set Pages to deploy from branch `updates`,
   root.
4. A GitHub environment named `release` with these secrets:

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
