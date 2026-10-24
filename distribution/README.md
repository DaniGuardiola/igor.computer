# Distribution

The app bundles Node, its MCP dependencies, and the browser image recipe. It does not require this checkout or a separately installed Node. Lima, QEMU and Docker are installed by the Homebrew cask, or explicitly from the DMG app's setup window using an existing Homebrew installation. First launch builds the browser image; the profile remains in its Docker volume during app updates.

Build a development DMG with `npm run build:mac` then `bash scripts/package-dmg.sh`. These local builds are ad-hoc signed, not public releases.

Signed, notarized releases and their Sparkle feed are built by GitHub Actions from a merged Changesets release PR: see [Releases](../docs/development.md#releases). Sparkle 2.10.0 is pinned with its GitHub release SHA-256 and embedded in the app. A build only checks for updates when `IGOR_UPDATE_FEED` and `IGOR_UPDATE_PUBLIC_KEY` are both set, which the release script does. The DMG can be used by both Sparkle and Homebrew.

The Homebrew cask lives in [DaniGuardiola/homebrew-tap](https://github.com/DaniGuardiola/homebrew-tap) (`brew install --cask daniguardiola/tap/igor-computer`). It installs Lima, QEMU and Docker as dependencies and declares `auto_updates true`, since Sparkle updates the app. An hourly workflow there moves it to each new stable release using the release's `SHA256SUMS`, so releasing needs no extra step or token. Previews aren't in the cask.

No installer or uninstall step removes `igor-computer-profile`, `igor-computer-home`, or `igor-computer-workspace`: they contain the user's browser session. Removing those volumes must be an explicit user action.
