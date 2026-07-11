#!/usr/bin/env bash
# Native BluRidge CEO shell for Apple Silicon + macOS 26 (Objective-C / clang).
set -euo pipefail

MACOS="$(cd "$(dirname "$0")" && pwd)"
SRC="$MACOS/Sources/BluRidgeCEO/main.m"
OUT="${1:-$MACOS/.build/release/BluRidgeCEO}"
mkdir -p "$(dirname "$OUT")"

ARCH="$(uname -m)"
if [[ "$ARCH" != "arm64" ]]; then
  echo "Built for Apple Silicon (M3 / arm64). Host: $ARCH" >&2
  exit 1
fi

SDK="$(xcrun --show-sdk-path)"
DEPLOY="26.0"
TARGET="arm64-apple-macosx${DEPLOY}"

echo "→ Host:   macOS $(sw_vers -productVersion) ($ARCH)"
echo "→ SDK:    $SDK"
echo "→ Target: $TARGET"

xcrun clang \
  -isysroot "$SDK" \
  -target "$TARGET" \
  -Os \
  -fobjc-arc \
  -framework Cocoa \
  -framework WebKit \
  "$SRC" \
  -o "$OUT"

chmod +x "$OUT"
echo "✓ Binary: $OUT"
file "$OUT"
ls -lh "$OUT"
