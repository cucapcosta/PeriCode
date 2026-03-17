#!/usr/bin/env bash
# Creates a release: syncs version, commits, tags, and pushes.
# Usage: pnpm release <version>  (e.g. pnpm release 0.9.0)
set -euo pipefail

VERSION="${1:?Usage: release.sh <version> (e.g. 0.9.0)}"
VERSION="${VERSION#v}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

# Check for uncommitted changes (excluding version files we're about to change)
if ! git diff --quiet HEAD -- ':!package.json' ':!src-tauri/Cargo.toml' ':!src-tauri/tauri.conf.json' ':!pnpm-lock.yaml'; then
  echo "Error: You have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Sync versions
bash "$SCRIPT_DIR/version-sync.sh" "$VERSION"

# Update Cargo.lock
cd src-tauri && cargo check --quiet 2>/dev/null && cd ..

# Commit
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Release v${VERSION}"

echo ""
echo "Release v${VERSION} committed."
echo "Next steps:"
echo "  1. git push origin develop"
echo "  2. Open a PR from develop → main"
echo "  3. Fill in the Release Notes section in the PR template"
echo "  4. Merge the PR — CI will create the tag and release automatically"
