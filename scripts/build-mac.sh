#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/fetch-sparkle.sh
bash scripts/fetch-node.sh
project_dir="$PWD"
export IGOR_VERSION=$(.deps/node/bin/node -p "require('./package.json').version")
node_binary="$PWD/.deps/node/bin/node"
app_dir="$project_dir/build/igor.computer.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" "$app_dir/Contents/Frameworks"
swiftc -target arm64-apple-macosx13.0 -swift-version 5 -O -module-cache-path build/module-cache \
  macos/App.swift macos/Appearance.swift macos/BrowserWindows.swift macos/DesktopBar.swift macos/Pause.swift macos/WindowMode.swift macos/Setup.swift macos/SettingsGuide.swift macos/GuideView.swift macos/GuideTarget.swift macos/NotificationSetup.swift macos/SettingsReturn.swift macos/Updates.swift macos/Vendor/SettingsWindowTracker.swift \
  -o "$app_dir/Contents/MacOS/IgorComputer" \
  -F .deps/sparkle -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  -framework SwiftUI -framework AppKit -framework WebKit -framework UserNotifications -framework ServiceManagement
runtime_dir="$app_dir/Contents/Resources/runtime"
mkdir -p "$runtime_dir/bin" "$runtime_dir/scripts"
ditto src "$runtime_dir/src"
ditto node_modules "$runtime_dir/node_modules"
ditto container "$runtime_dir/container"
cp "$node_binary" "$runtime_dir/bin/node"
ditto scripts "$runtime_dir/scripts"
ditto vm "$runtime_dir/vm"
python3 - "$runtime_dir" <<'VERSION'
import json, os, pathlib, sys
value={'version': json.loads(pathlib.Path('package.json').read_text())['version'], 'build': int(os.environ.get('IGOR_BUILD_NUMBER','3'))}
(pathlib.Path(sys.argv[1])/'server-version.json').write_text(json.dumps(value))
VERSION
cp scripts/ensure-service.sh "$app_dir/Contents/Resources/ensure-service.sh"
ditto .deps/sparkle/Sparkle.framework "$app_dir/Contents/Frameworks/Sparkle.framework"
cp .deps/node/LICENSE "$app_dir/Contents/Resources/Node-LICENSE"
cp .deps/sparkle/LICENSE "$app_dir/Contents/Resources/Sparkle-LICENSE"
cp macos/Vendor/PermissionFlow-LICENSE "$app_dir/Contents/Resources/"
python3 - "$app_dir" <<'PLIST'
import os, plistlib, sys
info = dict(CFBundleExecutable='IgorComputer', CFBundleIdentifier='ai.igor.computer', CFBundleName='igor.computer',
    CFBundleVersion=os.environ.get('IGOR_BUILD_NUMBER', '3'), CFBundleShortVersionString=os.environ['IGOR_VERSION'], LSUIElement=True,
    LSMinimumSystemVersion='13.0', NSAppTransportSecurity=dict(NSAllowsLocalNetworking=True, NSAllowsArbitraryLoadsInWebContent=True))
feed, key = os.environ.get('IGOR_UPDATE_FEED'), os.environ.get('IGOR_UPDATE_PUBLIC_KEY')
if bool(feed) != bool(key): raise SystemExit('Set both IGOR_UPDATE_FEED and IGOR_UPDATE_PUBLIC_KEY for update-enabled builds.')
if feed:
    if not feed.startswith('https://'): raise SystemExit('Update feed must use HTTPS.')
    # Signed feed, verified archives, no profiling and no scripts in release notes.
    info.update(IgorUpdateChannel=os.environ.get('IGOR_UPDATE_CHANNEL', 'stable'), SUFeedURL=feed, SUPublicEDKey=key, SUEnableAutomaticChecks=True, SURequireSignedFeed=True,
        SUSignedFeedFailureExpirationInterval=0, SUVerifyUpdateBeforeExtraction=True, SUEnableSystemProfiling=False, SUEnableJavaScript=False)
with open(sys.argv[1] + '/Contents/Info.plist', 'wb') as f: plistlib.dump(info, f)
PLIST
if [ -n "${IGOR_SIGN_IDENTITY:-}" ]; then
  # Release builds: Developer ID with hardened runtime and timestamps, every Mach-O, inside out.
  python3 - "$app_dir" "$IGOR_SIGN_IDENTITY" macos/node.entitlements <<'SIGN'
import subprocess, sys
from pathlib import Path
app, identity, node_entitlements = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
def macho(path):
    with path.open('rb') as file: head = file.read(8)
    if head[:4] in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe'): return True
    # Fat binaries share their magic with Java class files; a fat header counts architectures.
    return head[:4] == b'\xca\xfe\xba\xbe' and int.from_bytes(head[4:8], 'big') < 45
def sign(path):
    command = ['codesign', '--force', '--sign', identity, '--timestamp', '--options', 'runtime']
    if path.name == 'node' and path.parent.name == 'bin': command += ['--entitlements', node_entitlements]
    else: command += ['--preserve-metadata=entitlements']
    subprocess.run(command + [str(path)], check=True)
for path in app.rglob('*'):
    if path.is_file() and not path.is_symlink() and macho(path): sign(path)
bundles = [p for p in app.rglob('*') if p.is_dir() and not p.is_symlink() and p.suffix in ('.app', '.xpc', '.framework')]
for path in sorted(bundles, key=lambda p: len(p.parts), reverse=True): sign(path)
sign(app)
SIGN
else
  # Development builds use ad-hoc signing.
  codesign --force --sign - "$runtime_dir/bin/node"
  codesign --force --sign - "$app_dir"
fi
codesign --verify --deep --strict "$app_dir"
printf 'Built %s\n' "$app_dir"
