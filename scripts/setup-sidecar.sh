#!/usr/bin/env bash
# setup-sidecar.sh — Copy the local Node.js binary into src-tauri/binaries/
# with the Tauri-required triple suffix for the current platform.
#
# Run this once before `pnpm tauri build`:
#   bash scripts/setup-sidecar.sh

set -euo pipefail

NODE_BIN=$(which node)
if [ -z "$NODE_BIN" ]; then
  echo "❌  Node.js not found. Install Node.js first." >&2
  exit 1
fi

# Resolve symlinks to get the real binary path
NODE_BIN=$(readlink -f "$NODE_BIN" 2>/dev/null || realpath "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")

# Get the Rust host triple (e.g. aarch64-apple-darwin)
TRIPLE=$(rustc -vV 2>/dev/null | grep '^host:' | cut -d' ' -f2)
if [ -z "$TRIPLE" ]; then
  echo "❌  Rust/Cargo not found. Install via: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi

DEST="src-tauri/binaries/node-server-${TRIPLE}"
mkdir -p src-tauri/binaries

echo "📦  Copying Node binary..."
echo "    From: $NODE_BIN"
echo "    To:   $DEST"
cp "$NODE_BIN" "$DEST"
chmod +x "$DEST"

echo "✅  Sidecar ready: $DEST ($(du -sh "$DEST" | cut -f1))"
