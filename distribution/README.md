# Distribution

The app bundles Node, its MCP dependencies, and the browser image recipe. It does not require this checkout or a separately installed Node. Lima, QEMU and Docker are installed by the Homebrew cask, or explicitly from the DMG app's setup window using an existing Homebrew installation. First launch builds the browser image; the profile remains in its Docker volume during app updates.

Build a development DMG with `npm run build:mac` then `bash scripts/package-dmg.sh`. These local builds are ad-hoc signed, not public releases.

Sparkle 2.10.0 is pinned with its GitHub release SHA-256 and embedded in the app. To enable automatic updates, set `IGOR_UPDATE_FEED` (HTTPS appcast URL), `IGOR_UPDATE_PUBLIC_KEY` (Sparkle Ed25519 public key), and an increasing `IGOR_BUILD_NUMBER` when building. Without an actual feed and key, development builds do not check for updates or show a nonfunctional update menu.

Before distribution: use Developer ID signing for the app, bundled Node, and Sparkle's nested executables and services; notarize and staple the app/DMG; generate the Ed25519 key with Sparkle's `generate_keys` (private key stays in Keychain); generate a signed appcast with `generate_appcast`; test an actual old-to-new installation. See https://sparkle-project.org/documentation/ for nested signing and appcast requirements. The DMG can be used by both Sparkle and Homebrew.

Render `igor-vm.rb.in` with the actual version, release artifact SHA-256, and download URL into a Homebrew tap. Use `auto_updates true` only for builds with a live Sparkle feed. Validate the rendered cask with Homebrew before publishing. The current repository and releases remain private; public appcast/download URLs are not configured. A private authenticated update host would need an explicit separate design.

No installer or uninstall step removes `igor-vm-profile`, `igor-vm-home`, or `igor-vm-workspace`: they contain the user's browser session. Removing those volumes must be an explicit user action.
