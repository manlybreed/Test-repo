#!/usr/bin/env bash
# Package BluRidge CEO.app into a compressed UDZO .dmg (Apple Silicon / macOS 26).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/macos"
APP="$DIST/BluRidge CEO.app"
STAGE="$DIST/dmg-stage"
DMG_RW="$DIST/BluRidge-CEO-rw.dmg"
DMG="$DIST/BluRidge-CEO-macOS26-arm64.dmg"
VOL="BluRidge CEO"
SERVER="$APP/Contents/Resources/ceo-app/server.js"

if [[ ! -d "$APP" ]]; then
  echo "Missing app bundle: $APP" >&2
  echo "Run: npm run desktop:build" >&2
  exit 1
fi

if [[ ! -f "$SERVER" ]]; then
  echo "Incomplete app — missing embedded Next server:" >&2
  echo "  $SERVER" >&2
  echo "Run: npm run desktop:build (do not DMG a shell-only app)." >&2
  exit 1
fi

CHUNKS="$APP/Contents/Resources/ceo-app/.next/static/chunks"
if [[ ! -d "$CHUNKS" ]]; then
  echo "Incomplete app — static chunks missing (UI would be blank):" >&2
  echo "  $CHUNKS" >&2
  echo "Run: npm run desktop:build" >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "DMG is produced for Apple Silicon (arm64)." >&2
  exit 1
fi

echo "→ Staging DMG contents…"
rm -rf "$STAGE" "$DMG_RW" "$DMG"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/BluRidge CEO.app"
ln -s /Applications "$STAGE/Applications"

cat > "$STAGE/README.txt" <<'EOF'
BluRidge CEO — macOS 26 (Apple Silicon)

Install
1. Drag “BluRidge CEO” into Applications.
2. On first open: right-click → Open if Gatekeeper warns (unsigned build).

Requirements
- macOS 26+, Apple Silicon (M3)
- Postgres running (same DATABASE_URL as .env / Docker)
- Node.js installed (Homebrew) so the embedded server can start

Dev against a running Next server instead:
  CEO_DESKTOP_URL=http://127.0.0.1:3000 open -a "BluRidge CEO"
EOF

echo "→ Creating compressed DMG…"
hdiutil create \
  -volname "$VOL" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDRW \
  "$DMG_RW" >/dev/null

hdiutil convert "$DMG_RW" -format UDZO -imagekey zlib-level=9 -o "$DMG" >/dev/null
rm -f "$DMG_RW"
rm -rf "$STAGE"

echo "✓ DMG: $DMG"
ls -lh "$DMG"
file "$DMG"

# Size sanity: shell-only was ~30KB; complete should be much larger
SIZE_BYTES=$(stat -f%z "$DMG")
if [[ "$SIZE_BYTES" -lt 1000000 ]]; then
  echo "WARNING: DMG is only ${SIZE_BYTES} bytes — likely incomplete." >&2
  exit 1
fi
