# AI Ghostwriter Realtime Assistant

This repository hosts the scaffolding for a voice-first ghostwriting workspace built with:

- **Next.js 15.5** (App Router, TypeScript)
- **Convex** for reactive data + background actions
- **OpenAI Realtime API** for audio-first collaboration

The high-level requirements and delivery plan live in [`docs/prd/ai-ghostwriter-prd.md`](docs/prd/ai-ghostwriter-prd.md) and [`docs/implementation.md`](docs/implementation.md).

## Getting Started

> **Note:** Dependencies are declared but not yet installed (network access is disabled in this environment). After cloning, run `npm install` locally to produce `node_modules` and a `package-lock.json`.

```bash
npm install
npm run dev
```

The app uses the Next.js App Router. Pages are served from the `app/` directory.

## Environment Variables

Duplicate `.env.example` to `.env.local` and provide values before running the stack.

```bash
cp .env.example .env.local
```

## Project Layout

```
app/                # Next.js routes and layout
components/         # Shared React components (stub)
convex/             # Convex schema and server functions
lib/                # Shared utilities (stub)
public/             # Static assets
```

For detailed milestones, refer to [`docs/implementation.md`](docs/implementation.md).
