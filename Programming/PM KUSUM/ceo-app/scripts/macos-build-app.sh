#!/usr/bin/env bash
# Build BluRidge CEO.app with embedded Next.js standalone + DMG.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS="$ROOT/macos"
DIST="$ROOT/dist/macos"
APP="$DIST/BluRidge CEO.app"
BIN_DIR="$MACOS/.build/release"
RES="$APP/Contents/Resources/ceo-app"

echo "→ Preparing Next.js standalone build…"
cd "$ROOT"
npm run desktop:prepare

echo "→ Compiling native Mac shell (release)…"
chmod +x "$MACOS/build-shell.sh"
bash "$MACOS/build-shell.sh" "$BIN_DIR/BluRidgeCEO"

echo "→ Assembling .app bundle…"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$RES"

cp "$BIN_DIR/BluRidgeCEO" "$APP/Contents/MacOS/BluRidgeCEO"
cp "$MACOS/Info.plist" "$APP/Contents/Info.plist"
chmod +x "$APP/Contents/MacOS/BluRidgeCEO"

STANDALONE="$ROOT/.next/standalone"
if [[ ! -f "$STANDALONE/server.js" ]]; then
  echo "Standalone server missing at $STANDALONE/server.js" >&2
  echo "Ensure next.config.ts has output: 'standalone'." >&2
  exit 1
fi

rsync -a --delete \
  --exclude node_modules/.cache \
  "$STANDALONE/" "$RES/"

mkdir -p "$RES/.next/static"
# Trailing slashes copy *contents* into .next/static (avoid .next/static/static nest)
rsync -a --delete "$ROOT/.next/static/" "$RES/.next/static/"
mkdir -p "$RES/public"
rsync -a --delete "$ROOT/public/" "$RES/public/" 2>/dev/null || true

# Gate: client chunks must exist at the path Next serves
if [[ ! -d "$RES/.next/static/chunks" ]]; then
  echo "FATAL: missing $RES/.next/static/chunks (static assets mis-copied)." >&2
  ls -la "$RES/.next/static" >&2 || true
  exit 1
fi

mkdir -p "$RES/node_modules"
if [[ -d "$ROOT/node_modules/.prisma" ]]; then
  rsync -a "$ROOT/node_modules/.prisma" "$RES/node_modules/"
fi
if [[ -d "$ROOT/node_modules/@prisma" ]]; then
  rsync -a "$ROOT/node_modules/@prisma" "$RES/node_modules/"
fi
rsync -a "$ROOT/prisma" "$RES/"

if [[ -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env" "$RES/.env"
fi
if [[ -f "$ROOT/.env.local" ]]; then
  cp "$ROOT/.env.local" "$RES/.env.local"
fi

node -e "
const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync('$ROOT/package.json','utf8'));
fs.writeFileSync('$RES/package.json', JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  private: true,
}, null, 2));
"

# Gate: never ship an incomplete app
if [[ ! -f "$RES/server.js" ]]; then
  echo "FATAL: $RES/server.js missing after assemble." >&2
  exit 1
fi

echo "✓ Built: $APP"
echo "  server.js: $(ls -lh "$RES/server.js" | awk '{print $5}')"

echo "→ Packaging DMG…"
bash "$ROOT/scripts/macos-make-dmg.sh"
