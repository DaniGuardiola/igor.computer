#!/bin/bash
# Builds, signs and notarizes the app and DMG into release-output/.
# Adapted from extend.computer's release pipeline. Signing material stays in a temporary keychain.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_API_KEY SPARKLE_PUBLIC_KEY RELEASE_BUILD RELEASE_REPOSITORY; do
  [[ -n ${!name:-} ]] || { echo "Missing release setting: $name" >&2; exit 1; }
done
temporary=$(mktemp -d)
keychain="$temporary/release.keychain-db"
cleanup() {
  if [[ -f "$temporary/keychain-search-list.json" ]]; then
    python3 - "$temporary/keychain-search-list.json" <<'PY'
import json, subprocess, sys
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *json.load(open(sys.argv[1]))], check=False)
PY
  fi
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$temporary"
}
trap cleanup EXIT
umask 077
keychain_password=$(openssl rand -hex 32)
printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$temporary/certificate.p12"
printf '%s' "$APPLE_API_KEY" > "$temporary/AuthKey.p8"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$temporary/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
python3 - "$temporary/keychain-search-list.json" "$keychain" <<'PY'
import json, shlex, subprocess, sys
previous = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
with open(sys.argv[1], 'w') as out: json.dump(previous, out)
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', sys.argv[2], *previous], check=True)
PY
# codesign's name matching can misread accented names; sign by the identity's fingerprint.
identity=$(python3 - "$keychain" <<'PY'
import os, re, subprocess, sys
identities = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning', sys.argv[1]], text=True)
matches = [digest for digest, name in re.findall(r'([0-9A-F]{40}) "([^"]+)"', identities)
           if name == os.environ['APPLE_SIGNING_IDENTITY'] and name.startswith('Developer ID Application:')
           and name.endswith('(' + os.environ['APPLE_TEAM_ID'] + ')')]
if len(matches) != 1: raise SystemExit('Expected exactly one Developer ID Application identity for the configured team.')
print(matches[0])
PY
)
feed=${UPDATE_FEED:-https://github.com/$RELEASE_REPOSITORY/releases/latest/download/appcast.xml}
IGOR_SIGN_IDENTITY="$identity" IGOR_BUILD_NUMBER="$RELEASE_BUILD" IGOR_UPDATE_FEED="$feed" IGOR_UPDATE_PUBLIC_KEY="$SPARKLE_PUBLIC_KEY" \
  bash scripts/build-mac.sh
app="$root/build/igor.computer.app"
codesign --verify --deep --strict "$app"
codesign -dvv "$app" 2>&1 | grep -qx "TeamIdentifier=$APPLE_TEAM_ID" || { echo 'Apple signing team mismatch' >&2; exit 1; }
mkdir -p release-output
notarize() {
  local archive=$1 receipt=$2
  # Receipts and rejection logs hold no secrets; keep them for failed releases.
  xcrun notarytool submit "$archive" --key "$temporary/AuthKey.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --output-format json > "$receipt"
  if ! python3 -c 'import json, sys; sys.exit(json.load(open(sys.argv[1]))["status"] != "Accepted")' "$receipt"; then
    local submission
    submission=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["id"])' "$receipt")
    xcrun notarytool log "$submission" --key "$temporary/AuthKey.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" "$receipt.log.json" || true
    echo "Notarization failed: $submission" >&2
    return 1
  fi
}
ditto -c -k --keepParent "$app" "$temporary/notarize.zip"
notarize "$temporary/notarize.zip" "$root/release-output/app-notarization.json"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose "$app"
bash scripts/package-dmg.sh
version=$(node -p "require('./package.json').version")
dmg="$root/release-output/igor.computer-$version-arm64.dmg"
mv "build/dmg/igor.computer-$version-arm64.dmg" "$dmg"
codesign --sign "$identity" --timestamp "$dmg"
notarize "$dmg" "$root/release-output/dmg-notarization.json"
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
(cd release-output && shasum -a 256 "$(basename "$dmg")" > SHA256SUMS)
