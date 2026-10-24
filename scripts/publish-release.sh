#!/bin/bash
# Publishes release-output/: the GitHub release first, then the feed that points at it.
# Adapted from extend.computer's scripts/publish-release.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
tag="v$RELEASE_VERSION"
dmg="release-output/igor.computer-$RELEASE_VERSION-arm64.dmg"
if ! gh release view "$tag" --repo "$RELEASE_REPOSITORY" >/dev/null 2>&1; then
  # A fixed-name copy gives stable releases a permanent releases/latest/download link.
  cp "$dmg" release-output/igor.computer-arm64.dmg
  args=("$tag" --repo "$RELEASE_REPOSITORY" --target "$GITHUB_SHA" --title "igor.computer $RELEASE_VERSION" --notes-file release-output/notes.md
    "$dmg" release-output/SHA256SUMS release-output/release-metadata.json)
  if [[ $RELEASE_CHANNEL == stable ]]; then args+=(release-output/igor.computer-arm64.dmg --latest); else args+=(--prerelease --latest=false); fi
  gh release create "${args[@]}"
fi
# The updates branch is the GitHub Pages source (updates / root).
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
cp -R release-output/updates "$temporary/updates"
git -C "$temporary" init -q -b updates
git -C "$temporary" config user.name 'github-actions[bot]'
git -C "$temporary" config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git -C "$temporary" remote add origin "https://github.com/$RELEASE_REPOSITORY.git"
# Authenticate through gh, never through the remote URL.
git -C "$temporary" config credential.helper ''
git -C "$temporary" config --add credential.helper '!gh auth git-credential'
if git -C "$temporary" ls-remote --exit-code --heads origin updates >/dev/null; then
  git -C "$temporary" fetch -q origin updates
  git -C "$temporary" reset -q --mixed FETCH_HEAD
fi
touch "$temporary/.nojekyll"
git -C "$temporary" add updates .nojekyll
git -C "$temporary" commit -q -m "Publish $RELEASE_CHANNEL update $RELEASE_VERSION"
git -C "$temporary" push -q origin HEAD:updates
# Pushes made with the Actions token don't trigger a Pages build on their own.
if gh api "repos/$RELEASE_REPOSITORY/pages" --silent >/dev/null 2>&1; then
  gh api --method POST "repos/$RELEASE_REPOSITORY/pages/builds" --silent
else
  echo '::warning::The feed is on the updates branch. Enable GitHub Pages from updates / root so apps can read it.'
fi
