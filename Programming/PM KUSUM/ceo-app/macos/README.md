# BluRidge CEO — macOS app

Native **AppKit + WKWebView** shell for **Apple Silicon (M3) on macOS 26+**.

Built with **Objective-C / clang** (not Electron, not Swift) so it works with the macOS 26 Command Line Tools SDK.

## Requirements

- macOS **26.0+** (tested on 26.5)
- Apple Silicon **arm64** (M3)
- Xcode Command Line Tools
- Node 20+ (to spawn the embedded Next server)
- Local Postgres (same `.env` / Docker as the web app)

## Dev

```bash
docker compose up -d
npm run dev

# separate terminal
npm run desktop:dev
```

## Build complete `.app` + `.dmg`

```bash
npm run desktop:build
```

Outputs:

- `dist/macos/BluRidge CEO.app` — includes `Contents/Resources/ceo-app/server.js`
- `dist/macos/BluRidge-CEO-macOS26-arm64.dmg` — drag to Applications

DMG packaging **refuses** to run if `server.js` is missing (prevents the empty-shell bug).

```bash
npm run desktop:dmg    # DMG only, after a valid .app exists
npm run desktop:open   # open the .app
```

## Environment

| Variable | Purpose |
|--|--|
| `CEO_DESKTOP_URL` | Skip spawning Next; load this URL (dev) |
| `CEO_APP_ROOT` | Override path to ceo-app |
| `CEO_DESKTOP_PORT` | Spawned server port (default `4310`) |

## Performance

- System WKWebView (no Chromium)
- Next `output: "standalone"`
- `optimizePackageImports` for lucide / framer-motion / date-fns
- Injects `window.__BLURIDGE_DESKTOP__` + `data-desktop="1"`
- Server bound to `127.0.0.1` only
- Binary: `-Os` for `arm64-apple-macosx26.0`
