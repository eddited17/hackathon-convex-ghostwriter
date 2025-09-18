# Base Setup Snapshot (September 2025)

## Frontend
- Next.js 15.5 App Router with TypeScript (`app/` directory)
- Global layout + placeholder landing page referencing planning docs
- Shared `components/` and `lib/` directories ready for parallel tracks
- ESLint (`next/core-web-vitals`) and Prettier config seeded

## Backend (Convex)
- Schema stubs for users, projects, projectBlueprints, sessions, messages, notes, documents, documentSections, todos
- `functions.example.ts` demonstrates how to wire queries/mutations once `./_generated` bindings are available
- `convex.json` placeholder values; follow `convex/README.md` to link deployments

## Tooling
- `.env.example` enumerates OpenAI, Convex, better-auth, and Stripe/Autumn secrets
- `package.json` scripts: `dev`, `build`, `start`, `lint`, `typecheck`
- Repository-level `.gitignore`, README, and documentation pointers

Use this snapshot to align new branches before growing feature slices.
