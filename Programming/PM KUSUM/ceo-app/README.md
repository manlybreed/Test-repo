# BluRidge CEO Command Center

CEO-only operations app for **The BluRidge** — agreements, GST invoicing, salary slips, time tracking, and a Claude assistant.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- Prisma + PostgreSQL 16
- NextAuth (credentials, CEO role)
- `docx` + `@react-pdf/renderer` for documents
- Anthropic Claude API for the assistant

## Quick start

```bash
cd ceo-app
docker compose up -d
cp .env.example .env   # if needed — .env is already present for local dev
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Default login**

- Email: `ceo@thebluridge.com`
- Password: `bluridge-ceo`

Add your Anthropic key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Modules

| Path | Purpose |
|------|---------|
| `/ceo` | Overview |
| `/ceo/assistant` | Claude CEO assistant (tool-calling) |
| `/ceo/agreements` | PM KUSUM Finance Advisory DOCX |
| `/ceo/invoices` | GST tax invoices (continues from INV-08) |
| `/ceo/payroll` | Employees + salary slip PDFs |
| `/ceo/time` | Tasks + Pomodoro |

Generated files land in `storage/` and download via `/api/files/...`.

## Reference assets

- Agreement template source: `templates/BluRidge_PMKUSUM_FinanceAdvisory_Agreement_2.docx`
- Past invoices: `reference/INV-04.pdf` … `INV-08.pdf`
- Brand logos: `public/brand/`

## Scripts

- `npm run dev` — development server
- `npm run build` / `npm start` — production
- `npm run db:push` — sync Prisma schema
- `npm run db:seed` — CEO user, company GST profile, sample client/employee
- `npm run desktop:dev` — native Mac window against `npm run dev`
- `npm run desktop:build` — complete `.app` + DMG (embedded Next standalone)
- `npm run desktop:dmg` — recreate DMG from an already-built `.app`
- `npm run desktop:open` — open the built `.app`

## Mac desktop app

Native Objective-C + WKWebView shell for Apple Silicon / macOS 26. See [`macos/README.md`](macos/README.md).

```bash
npm run desktop:build
open dist/macos/BluRidge-CEO-macOS26-arm64.dmg
```

Requires Postgres (Docker) matching `.env`. The DMG embeds the Next.js server; it will not open without `Contents/Resources/ceo-app/server.js`.
