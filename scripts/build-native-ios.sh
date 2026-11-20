#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
  echo "Fetch the full Git history to calculate the iOS build number." >&2
  exit 1
fi

upstream=$(node -p 'require("./package.json").version')
native=$(awk '$1 == "MARKETING_VERSION:" { print $2; exit }' ios/project.yml)
if [[ ! "$native" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Set a three-part iOS MARKETING_VERSION in ios/project.yml." >&2
  exit 1
fi

revision=$(git rev-parse HEAD)
build=$(git rev-list --first-parent --count "$revision")
dirty=
if ! git diff --quiet HEAD -- || [[ -n "$(git ls-files --others --exclude-standard -- ios/Sources ios/Config)" ]]; then
  dirty=.dirty
fi

if [[ "${1:-}" == --version ]]; then
  printf 'Upstream %s\nFork %s+fork.%s%s\niOS %s (%s)\nCommit %s\n' \
    "$upstream" "$upstream" "${revision:0:12}" "$dirty" "$native" "$build" "$revision"
  exit
fi

exec xcodebuild -project ios/Dossier.xcodeproj -scheme Dossier "$@" \
  "MARKETING_VERSION=$native" "CURRENT_PROJECT_VERSION=$build" \
  "DOSSIER_UPSTREAM_VERSION=$upstream" "DOSSIER_FORK_REVISION=$revision$dirty"
