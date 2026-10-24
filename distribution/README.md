# Distribution

The app bundles Node, its MCP dependencies, and the browser image recipe. It does not require this checkout or a separately installed Node. Lima, QEMU and Docker are installed by the Homebrew cask, or explicitly from the DMG app's setup window using an existing Homebrew installation. First launch builds the browser image; the profile remains in its Docker volume during app updates.

Build a development DMG with `npm run build:mac` then `bash scripts/package-dmg.sh`. These local builds are ad-hoc signed, not public releases.

Signed, notarized releases and their Sparkle feed are built by GitHub Actions on a version tag: see [Releases](../docs/development.md#releases). Sparkle 2.10.0 is pinned with its GitHub release SHA-256 and embedded in the app. A build only checks for updates when `IGOR_UPDATE_FEED` and `IGOR_UPDATE_PUBLIC_KEY` are both set, which the release script does. The DMG can be used by both Sparkle and Homebrew.

Render `igor-computer.rb.in` with the actual version, release artifact SHA-256, and download URL into a Homebrew tap. Use `auto_updates true` only for builds with a live Sparkle feed. Validate the rendered cask with Homebrew before publishing. The release's `SHA256SUMS` has the hash; `releases/latest/download/igor.computer-arm64.dmg` is a stable download URL, but a cask should pin the versioned one.

No installer or uninstall step removes `igor-computer-profile`, `igor-computer-home`, or `igor-computer-workspace`: they contain the user's browser session. Removing those volumes must be an explicit user action.
