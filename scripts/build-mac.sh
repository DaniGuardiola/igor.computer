#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
node_binary="$(node -p 'process.execPath')"
app_dir="$project_dir/build/Igor Browser.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
swiftc -target arm64-apple-macosx13.0 -swift-version 5 -O macos/App.swift -o "$app_dir/Contents/MacOS/IgorBrowser" \
  -framework AppKit -framework WebKit -framework UserNotifications -framework ServiceManagement
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>IgorBrowser</string>
<key>CFBundleIdentifier</key><string>ai.igor.browser</string>
<key>CFBundleName</key><string>Igor Browser</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>
PLIST
{
  printf '#!/bin/bash\nset -euo pipefail\nexport PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n'
  printf 'cd %q\n' "$project_dir"
  printf 'colima start igor-browser --mount none --activate=false\n'
  printf 'bash scripts/start-browser.sh\n'
  printf 'exec %q src/service.mjs\n' "$node_binary"
} > "$app_dir/Contents/Resources/run-service.sh"
codesign --force --sign - "$app_dir"
printf 'Built %s\n' "$app_dir"
