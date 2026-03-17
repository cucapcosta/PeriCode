#!/usr/bin/env bash
# Syncs version across package.json, Cargo.toml, and tauri.conf.json
set -euo pipefail

VERSION="${1:?Usage: version-sync.sh <version> (e.g. 0.9.0)}"

# Strip leading 'v' if present
VERSION="${VERSION#v}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "Syncing version to ${VERSION}..."

# package.json
cd "$ROOT"
pnpm pkg set version="$VERSION"
echo "  Updated package.json"

# src-tauri/Cargo.toml
sed -i "s/^version = \".*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml
echo "  Updated Cargo.toml"

# src-tauri/tauri.conf.json
sed -i "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json
echo "  Updated tauri.conf.json"

echo "Done. All files set to v${VERSION}"
