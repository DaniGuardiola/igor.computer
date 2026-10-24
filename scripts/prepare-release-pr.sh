#!/bin/bash
# Turns pending changesets into a release PR. Adapted from extend.computer's.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(python3 scripts/release.py pending) == true ]] || exit 0
branch=changeset-release/main
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git switch -C "$branch"
npm run release:version
version=$(node -p "require('./package.json').version")
git add .changeset CHANGELOG.md package.json package-lock.json
git commit -q -m "Release igor.computer $version"
git push -q --force-with-lease origin "HEAD:$branch"
body=$(mktemp)
trap 'rm -f "$body"' EXIT
python3 scripts/release.py notes > "$body"
number=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')
if [[ -n $number ]]; then
  gh pr edit "$number" --title "Release igor.computer $version" --body-file "$body"
else
  gh pr create --head "$branch" --base main --title "Release igor.computer $version" --body-file "$body"
fi
