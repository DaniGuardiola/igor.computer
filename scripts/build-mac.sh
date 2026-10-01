#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/fetch-sparkle.sh
bash scripts/fetch-node.sh
project_dir="$PWD"
node_binary="$PWD/.deps/node/bin/node"
app_dir="$project_dir/build/Igor Browser.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" "$app_dir/Contents/Frameworks"
swiftc -target arm64-apple-macosx13.0 -swift-version 5 -O -module-cache-path build/module-cache \
  macos/App.swift macos/Setup.swift macos/SettingsGuide.swift macos/Vendor/SettingsWindowTracker.swift \
  -o "$app_dir/Contents/MacOS/IgorBrowser" \
  -F .deps/sparkle -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  -framework AppKit -framework WebKit -framework UserNotifications -framework ServiceManagement
runtime_dir="$app_dir/Contents/Resources/runtime"
mkdir -p "$runtime_dir/bin" "$runtime_dir/scripts"
ditto src "$runtime_dir/src"
ditto node_modules "$runtime_dir/node_modules"
ditto container "$runtime_dir/container"
cp "$node_binary" "$runtime_dir/bin/node"
cp scripts/start-browser.sh "$runtime_dir/scripts/"
cp scripts/run-service.sh "$app_dir/Contents/Resources/run-service.sh"
ditto .deps/sparkle/Sparkle.framework "$app_dir/Contents/Frameworks/Sparkle.framework"
cp .deps/node/LICENSE "$app_dir/Contents/Resources/Node-LICENSE"
cp .deps/sparkle/LICENSE "$app_dir/Contents/Resources/Sparkle-LICENSE"
cp macos/Vendor/PermissionFlow-LICENSE "$app_dir/Contents/Resources/"
python3 - "$app_dir" <<'PLIST'
import os, plistlib, sys
info = dict(CFBundleExecutable='IgorBrowser', CFBundleIdentifier='ai.igor.browser', CFBundleName='Igor Browser',
    CFBundleVersion=os.environ.get('IGOR_BUILD_NUMBER', '2'), CFBundleShortVersionString='0.1.1', LSUIElement=True,
    LSMinimumSystemVersion='13.0', NSAppTransportSecurity=dict(NSAllowsLocalNetworking=True, NSAllowsArbitraryLoadsInWebContent=True))
feed, key = os.environ.get('IGOR_UPDATE_FEED'), os.environ.get('IGOR_UPDATE_PUBLIC_KEY')
if bool(feed) != bool(key): raise SystemExit('Set both IGOR_UPDATE_FEED and IGOR_UPDATE_PUBLIC_KEY for update-enabled builds.')
if feed:
    if not feed.startswith('https://'): raise SystemExit('Update feed must use HTTPS.')
    info.update(SUFeedURL=feed, SUPublicEDKey=key, SUEnableAutomaticChecks=True)
with open(sys.argv[1] + '/Contents/Info.plist', 'wb') as f: plistlib.dump(info, f)
PLIST
# Development builds use ad-hoc signing. Release builds need nested Developer ID signing and notarization.
codesign --force --sign - "$runtime_dir/bin/node"
codesign --force --sign - "$app_dir"
codesign --verify --deep --strict "$app_dir"
printf 'Built %s\n' "$app_dir"
